import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { createReadStream, mkdirSync } from 'node:fs'
import { unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { audit, db, newId, track } from './db.ts'
import { authed, getUser, requireAdmin } from './guards.ts'

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? 'uploads')
mkdirSync(UPLOAD_DIR, { recursive: true })

const MAX_SELFIE = 5 * 1024 * 1024
const MAX_VOICE = 10 * 1024 * 1024

/** The type is decided from the file's own bytes; the client-supplied type is ignored. */
export function sniffImage(b: Buffer): { mime: string; ext: string } | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' }
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' }
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' }
  return null
}

export function sniffAudio(b: Buffer): { mime: string; ext: string } | null {
  if (b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { mime: 'audio/webm', ext: 'webm' }
  if (b.length > 4 && b.toString('latin1', 0, 4) === 'OggS') return { mime: 'audio/ogg', ext: 'ogg' }
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WAVE') return { mime: 'audio/wav', ext: 'wav' }
  if (b.length > 12 && b.toString('latin1', 4, 8) === 'ftyp') return { mime: 'audio/mp4', ext: 'm4a' }
  if (b.length > 3 && (b.toString('latin1', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0))) return { mime: 'audio/mpeg', ext: 'mp3' }
  return null
}

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const r = fn()
    db.exec('COMMIT')
    return r
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export const removeQuietly = (...files: string[]) =>
  Promise.all(files.filter(Boolean).map((f) => unlink(path.join(UPLOAD_DIR, f)).catch(() => {})))

/** A file that is gone (or never existed) counts as removed; any other failure means it is still there. */
async function removeFile(name: string): Promise<boolean> {
  if (!name) return true
  try { await unlink(path.join(UPLOAD_DIR, name)); return true } catch (e: any) { return e?.code === 'ENOENT' }
}

/**
 * Once a verification is decided the selfie and voice clip are no longer needed, so they are deleted. The row keeps
 * the decision, the reviewer and the dates, and records when the files were removed. Safe to run repeatedly: anything
 * that failed to delete the first time is picked up again (on the next decision and on every start).
 */
export async function deleteDecidedVerificationMedia(verificationId?: string): Promise<number> {
  const rows = (verificationId
    ? db.prepare("SELECT id, selfie_file, voice_file FROM verifications WHERE id = ? AND status != 'pending' AND media_deleted_at IS NULL").all(verificationId)
    : db.prepare("SELECT id, selfie_file, voice_file FROM verifications WHERE status != 'pending' AND media_deleted_at IS NULL").all()
  ) as { id: string; selfie_file: string; voice_file: string }[]
  let done = 0
  for (const r of rows) {
    const okSelfie = await removeFile(r.selfie_file)
    const okVoice = await removeFile(r.voice_file)
    if (!okSelfie || !okVoice) continue // still on disk: try again later, and do not claim it is deleted
    db.prepare("UPDATE verifications SET selfie_file = '', voice_file = '', media_deleted_at = ? WHERE id = ?").run(Date.now(), r.id)
    track('verification_media_deleted', null, { verificationId: r.id })
    done += 1
  }
  return done
}

type VerificationRow = {
  id: string; user_id: string; selfie_file: string; selfie_mime: string
  voice_file: string; voice_mime: string; status: string; reason: string | null
  reviewed_by: string | null; created_at: number; reviewed_at: number | null; media_deleted_at: number | null
}

export async function verificationRoutes(app: FastifyInstance) {
  // Registered inside this plugin so upload limits apply only to these routes.
  await app.register(multipart, { limits: { fileSize: MAX_VOICE, files: 2, fields: 0, parts: 2 } })

  // Catch anything that was not deleted when it was decided (a failed delete, or files from before this rule existed).
  void deleteDecidedVerificationMedia().catch(() => {})
  setInterval(() => { void deleteDecidedVerificationMedia().catch(() => {}) }, 60 * 60 * 1000).unref()

  // ---- user side ----------------------------------------------------------
  app.get('/v0/verification', authed, async (req, reply) => {
    const u = getUser(req.user.sub)
    if (!u) return reply.code(401).send({ error: 'unauthorized' })
    return {
      status: u.status,
      reason: u.status === 'rejected' ? u.rejection_reason : null,
      canSubmit: u.status === 'unverified' || u.status === 'rejected',
    }
  })

  app.post('/v0/verification', authed, async (req, reply) => {
    const u = getUser(req.user.sub)
    if (!u) return reply.code(401).send({ error: 'unauthorized' })
    if (u.status !== 'unverified' && u.status !== 'rejected') {
      return reply.code(409).send({ error: 'cannot_submit', status: u.status })
    }
    if (!req.isMultipart()) return reply.code(415).send({ error: 'multipart_required' })

    const buffers: Partial<Record<'selfie' | 'voice', Buffer>> = {}
    try {
      for await (const part of req.parts()) {
        if (part.type !== 'file' || (part.fieldname !== 'selfie' && part.fieldname !== 'voice') || buffers[part.fieldname]) {
          return reply.code(400).send({ error: 'invalid_input' })
        }
        buffers[part.fieldname] = await part.toBuffer() // throws if over the size limit
      }
    } catch (e: any) {
      if (e?.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: 'file_too_large' })
      return reply.code(400).send({ error: 'invalid_input' })
    }

    const { selfie, voice } = buffers
    if (!selfie || !voice) return reply.code(400).send({ error: 'selfie_and_voice_required' })
    if (selfie.length > MAX_SELFIE) return reply.code(413).send({ error: 'file_too_large', field: 'selfie' })
    const selfieType = sniffImage(selfie)
    const voiceType = sniffAudio(voice)
    if (!selfieType) return reply.code(415).send({ error: 'unsupported_type', field: 'selfie' })
    if (!voiceType) return reply.code(415).send({ error: 'unsupported_type', field: 'voice' })

    // File names are server-generated; nothing from the client reaches the filesystem path.
    const selfieFile = `${newId()}.${selfieType.ext}`
    const voiceFile = `${newId()}.${voiceType.ext}`
    await writeFile(path.join(UPLOAD_DIR, selfieFile), selfie, { mode: 0o600 })
    await writeFile(path.join(UPLOAD_DIR, voiceFile), voice, { mode: 0o600 })

    try {
      tx(() => {
        db.prepare(
          'INSERT INTO verifications (id,user_id,selfie_file,selfie_mime,voice_file,voice_mime,created_at) VALUES (?,?,?,?,?,?,?)',
        ).run(newId(), u.id, selfieFile, selfieType.mime, voiceFile, voiceType.mime, Date.now())
        db.prepare("UPDATE users SET status='pending', rejection_reason=NULL WHERE id=? AND status IN ('unverified','rejected')").run(u.id)
      })
    } catch (e: any) {
      await removeQuietly(selfieFile, voiceFile)
      // A concurrent submission hit the one-pending-per-user index.
      if (String(e?.message).includes('UNIQUE')) return reply.code(409).send({ error: 'cannot_submit', status: 'pending' })
      throw e
    }
    track('verification_submitted', u.id)
    return reply.code(201).send({ status: 'pending' })
  })

  // ---- admin side ---------------------------------------------------------
  const admin = { ...authed, preHandler: [requireAdmin] }

  app.get('/v0/admin/verifications', admin, async (req, reply) => {
    const q = z.object({ status: z.enum(['pending', 'approved', 'rejected']).default('pending') }).safeParse(req.query)
    if (!q.success) return reply.code(400).send({ error: 'invalid_input' })
    const rows = db.prepare(`
      SELECT v.id, v.status, v.reason, v.created_at, v.reviewed_at, v.media_deleted_at, u.member_id, u.name, u.age, u.email
      FROM verifications v JOIN users u ON u.id = v.user_id
      WHERE v.status = ? ORDER BY v.created_at ASC LIMIT 100`).all(q.data.status) as any[]
    return rows.map((r) => ({
      id: r.id, status: r.status, reason: r.reason, createdAt: r.created_at, reviewedAt: r.reviewed_at,
      mediaDeleted: r.media_deleted_at != null,
      user: { memberId: r.member_id, name: r.name, age: r.age, email: r.email },
    }))
  })

  app.get('/v0/admin/verifications/:id/:kind', admin, async (req, reply) => {
    const p = z.object({ id: z.string().uuid(), kind: z.enum(['selfie', 'voice']) }).safeParse(req.params)
    if (!p.success) return reply.code(400).send({ error: 'invalid_input' })
    const v = db.prepare('SELECT * FROM verifications WHERE id = ?').get(p.data.id) as VerificationRow | undefined
    if (!v) return reply.code(404).send({ error: 'not_found' })
    // Deleted after the decision; there is nothing left to serve.
    if (v.media_deleted_at != null || !(p.data.kind === 'selfie' ? v.selfie_file : v.voice_file)) return reply.code(410).send({ error: 'media_deleted' })
    const file = p.data.kind === 'selfie' ? v.selfie_file : v.voice_file
    const mime = p.data.kind === 'selfie' ? v.selfie_mime : v.voice_mime
    const full = path.resolve(UPLOAD_DIR, file)
    if (!full.startsWith(UPLOAD_DIR + path.sep)) return reply.code(404).send({ error: 'not_found' })
    return reply
      .header('content-type', mime)
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, no-store')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .send(createReadStream(full))
  })

  app.post('/v0/admin/verifications/:id/decision', admin, async (req, reply) => {
    const id = z.string().uuid().safeParse((req.params as any).id)
    const body = z.discriminatedUnion('decision', [
      z.object({ decision: z.literal('approve') }),
      z.object({ decision: z.literal('reject'), reason: z.string().trim().min(1).max(300) }),
    ]).safeParse(req.body)
    if (!id.success || !body.success) return reply.code(400).send({ error: 'invalid_input' })

    const reviewer = req.user.sub
    const outcome = tx(() => {
      const v = db.prepare('SELECT * FROM verifications WHERE id = ?').get(id.data) as VerificationRow | undefined
      if (!v) return 'not_found' as const
      const approve = body.data.decision === 'approve'
      const reason = body.data.decision === 'reject' ? body.data.reason : null
      // Guarded on status='pending' so two admins can't both decide the same case.
      const res = db.prepare(
        "UPDATE verifications SET status=?, reason=?, reviewed_by=?, reviewed_at=? WHERE id=? AND status='pending'",
      ).run(approve ? 'approved' : 'rejected', reason, reviewer, Date.now(), v.id)
      if (res.changes === 0) return 'already_decided' as const
      db.prepare('UPDATE users SET status=?, rejection_reason=? WHERE id=?')
        .run(approve ? 'active' : 'rejected', reason, v.user_id)
      audit(reviewer, approve ? 'verification.approve' : 'verification.reject', v.user_id, { verificationId: v.id, reason })
      return 'ok' as const
    })
    if (outcome === 'not_found') return reply.code(404).send({ error: 'not_found' })
    if (outcome === 'already_decided') return reply.code(409).send({ error: 'already_decided' })
    const subject = db.prepare('SELECT user_id FROM verifications WHERE id = ?').get(id.data) as { user_id: string } | undefined
    track(body.data.decision === 'approve' ? 'verified' : 'verification_rejected', subject?.user_id ?? null, { by: reviewer })
    await deleteDecidedVerificationMedia(id.data) // the selfie and voice clip are not kept after the decision
    return { ok: true }
  })
}
