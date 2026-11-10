import type { FastifyInstance, FastifyRequest } from 'fastify'
import multipart from '@fastify/multipart'
import { createReadStream } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { db, newId, track } from '../db.ts'
import { authed, getUser, requireActive } from '../guards.ts'
import { UPLOAD_DIR, removeQuietly, sniffAudio, sniffImage, tx } from '../verification.ts'
import { checkMessageAllowed, errorStatus, notifyMessage, pushToUser } from './hooks.ts'

const MAX_BYTES = 5 * 1024 * 1024
const MAX_VOICE_MS = 120_000
const IMAGE_QUOTA = 20
const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000
const CHAT_DIR = 'chat'

const durationSchema = z.coerce.number().int().min(1).max(MAX_VOICE_MS)

/** The other participant's user id, or null when `userId` is not part of the connection. */
function otherParticipant(connectionId: string, userId: string): string | null {
  const c = db.prepare('SELECT a_id, b_id FROM connections WHERE id=?').get(connectionId) as { a_id: string; b_id: string } | undefined
  if (!c || (c.a_id !== userId && c.b_id !== userId)) return null
  return c.a_id === userId ? c.b_id : c.a_id
}

/** Image messages `senderId` sent on the connection within the rolling window: count and oldest timestamp. */
function imageUsage(connectionId: string, senderId: string) {
  return db.prepare(
    "SELECT COUNT(*) AS used, MIN(created_at) AS oldest FROM messages WHERE connection_id=? AND sender_id=? AND kind='image' AND created_at>?",
  ).get(connectionId, senderId, Date.now() - QUOTA_WINDOW_MS) as { used: number; oldest: number | null }
}

type Upload = { file: Buffer; durationMs: string | null }

async function readUpload(req: FastifyRequest): Promise<Upload | 'too_large' | 'invalid'> {
  let file: Buffer | null = null
  let durationMs: string | null = null
  try {
    for await (const part of req.parts()) {
      if (part.type === 'file' && part.fieldname === 'file' && !file) {
        file = await part.toBuffer() // throws if over the size limit
      } else if (part.type === 'field' && part.fieldname === 'durationMs' && durationMs === null && typeof part.value === 'string') {
        durationMs = part.value
      } else {
        return 'invalid'
      }
    }
  } catch (e: any) {
    return e?.code === 'FST_REQ_FILE_TOO_LARGE' ? 'too_large' : 'invalid'
  }
  return file ? { file, durationMs } : 'invalid'
}

/** Parses a single `bytes=a-b` range; null means "serve the whole file". */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header) : null
  if (!m || (m[1] === '' && m[2] === '')) return null
  let start: number
  let end: number
  if (m[1] === '') {
    const suffix = Number(m[2])
    if (suffix === 0) return 'unsatisfiable'
    start = Math.max(size - suffix, 0)
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  return start >= size || start > end ? 'unsatisfiable' : { start, end }
}

export async function attachmentRoutes(app: FastifyInstance) {
  // Registered inside this plugin so these limits apply only to attachment uploads.
  await app.register(multipart, { limits: { fileSize: MAX_BYTES, files: 1, fields: 1, parts: 2 } })
  await mkdir(path.join(UPLOAD_DIR, CHAT_DIR), { recursive: true })

  const member = { ...authed, preHandler: [requireActive] }

  app.post('/v0/connections/:id/attachments', member, async (req, reply) => {
    const { id } = req.params as { id: string }
    const otherId = otherParticipant(id, req.user.sub)
    if (!otherId) return reply.code(404).send({ error: 'not_found' })
    const refused = checkMessageAllowed(getUser(req.user.sub)!, otherId)
    if (refused) return reply.code(errorStatus(refused)).send({ error: refused })
    if (!req.isMultipart()) return reply.code(415).send({ error: 'multipart_required' })

    const upload = await readUpload(req)
    if (upload === 'too_large') return reply.code(413).send({ error: 'file_too_large' })
    if (upload === 'invalid') return reply.code(400).send({ error: 'invalid_input' })

    // The kind comes from the bytes; the client-supplied mime type and file name are never used.
    const image = sniffImage(upload.file)
    const audio = image ? null : sniffAudio(upload.file)
    const type = image ?? audio
    if (!type) return reply.code(415).send({ error: 'unsupported_type' })
    const kind = image ? 'image' : 'voice'
    // Members have no photos in this community; image messages stay off unless ALLOW_CHAT_IMAGES=true.
    if (kind === 'image' && process.env.ALLOW_CHAT_IMAGES !== 'true') return reply.code(415).send({ error: 'images_disabled' })

    let durationMs: number | null = null
    if (kind === 'voice') {
      const d = durationSchema.safeParse(upload.durationMs)
      if (!d.success) return reply.code(400).send({ error: 'invalid_input', field: 'durationMs' })
      durationMs = d.data
    }

    const file = `${CHAT_DIR}/${newId()}.${type.ext}`
    await writeFile(path.join(UPLOAD_DIR, file), upload.file, { mode: 0o600 })

    const firstMessage = !db.prepare('SELECT 1 FROM messages WHERE connection_id = ? LIMIT 1').get(id)
    const message = { id: newId(), createdAt: Date.now() }
    let stored: boolean
    try {
      // Counting and inserting in one transaction keeps the quota exact under concurrent uploads.
      stored = tx(() => {
        if (kind === 'image' && imageUsage(id, req.user.sub).used >= IMAGE_QUOTA) return false
        db.prepare(
          "INSERT INTO messages (id,connection_id,sender_id,body,kind,attachment_file,attachment_mime,attachment_duration_ms,created_at) VALUES (?,?,?,'',?,?,?,?,?)",
        ).run(message.id, id, req.user.sub, kind, file, type.mime, durationMs, message.createdAt)
        return true
      })
    } catch (e) {
      await removeQuietly(file)
      throw e
    }
    if (!stored) {
      await removeQuietly(file)
      return reply.code(429).send({ error: 'image_quota_exceeded' })
    }

    const view = { id: message.id, kind, body: '', attachmentMime: type.mime, attachmentDurationMs: durationMs, createdAt: message.createdAt }
    pushToUser(otherId, { type: 'message', connectionId: id, message: { ...view, mine: false } })
    if (firstMessage) track('chat_started', req.user.sub, { connectionId: id })
    track('message_sent', req.user.sub, { kind: kind === 'voice' ? 'voice' : 'attachment' })
    notifyMessage({ connectionId: id, senderId: req.user.sub, recipientId: otherId, preview: kind === 'image' ? '[Photo]' : '[Voice message]' })
    return reply.code(201).send({ ...view, mine: true })
  })

  app.get('/v0/connections/:id/attachments/quota', member, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!otherParticipant(id, req.user.sub)) return reply.code(404).send({ error: 'not_found' })
    const { used, oldest } = imageUsage(id, req.user.sub)
    // resetsAt is when the oldest counted photo leaves the window and frees a slot; null if none are counted.
    return { imagesRemaining: Math.max(IMAGE_QUOTA - used, 0), resetsAt: oldest === null ? null : oldest + QUOTA_WINDOW_MS }
  })

  app.get('/v0/connections/:id/messages/:messageId/attachment', member, async (req, reply) => {
    const { id, messageId } = req.params as { id: string; messageId: string }
    if (!otherParticipant(id, req.user.sub)) return reply.code(404).send({ error: 'not_found' })
    const m = db.prepare(
      'SELECT attachment_file, attachment_mime FROM messages WHERE id=? AND connection_id=? AND attachment_file IS NOT NULL',
    ).get(messageId, id) as { attachment_file: string; attachment_mime: string } | undefined
    if (!m) return reply.code(404).send({ error: 'not_found' })

    const chatRoot = path.join(UPLOAD_DIR, CHAT_DIR) + path.sep
    const full = path.resolve(UPLOAD_DIR, m.attachment_file)
    if (!full.startsWith(chatRoot)) return reply.code(404).send({ error: 'not_found' })
    const size = await stat(full).then((s) => (s.isFile() ? s.size : null), () => null)
    if (size === null) return reply.code(404).send({ error: 'not_found' })

    reply
      .header('content-type', m.attachment_mime)
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, no-store')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('accept-ranges', 'bytes')
    const range = parseRange(req.headers.range, size)
    if (range === 'unsatisfiable') return reply.code(416).header('content-range', `bytes */${size}`).send()
    if (!range) return reply.header('content-length', size).send(createReadStream(full))
    return reply
      .code(206)
      .header('content-range', `bytes ${range.start}-${range.end}/${size}`)
      .header('content-length', range.end - range.start + 1)
      .send(createReadStream(full, { start: range.start, end: range.end }))
  })
}
