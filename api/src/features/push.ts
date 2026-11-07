import { isIP } from 'node:net'
import type { FastifyInstance } from 'fastify'
import * as webpush from 'web-push'
import { z } from 'zod'
import { db, newId } from '../db.ts'
import { authed } from '../guards.ts'
import { tx } from '../verification.ts'
import { messageListeners, sockets, type MessageEvent } from './hooks.ts'

db.exec(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id, created_at);
`)

const MAX_SUBSCRIPTIONS_PER_USER = 10
const PUSH_TTL_SECONDS = 60 * 60
const SEND_TIMEOUT_MS = 10_000

// ---- configuration --------------------------------------------------------
type VapidConfig = { publicKey: string; privateKey: string; subject: string }

function readVapidConfig(): VapidConfig | null {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = process.env
  if (!publicKey || !privateKey || !subject) return null
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey) // validates all three
    return { publicKey, privateKey, subject }
  } catch (e) {
    console.warn(`push disabled: invalid VAPID configuration (${(e as Error).message})`)
    return null
  }
}

const vapid = readVapidConfig()

// ---- sender ---------------------------------------------------------------
export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } }
export type PushSender = (target: PushTarget, payload: string) => Promise<unknown>

let sender: PushSender | null = vapid
  ? (target, payload) => webpush.sendNotification(target, payload, { TTL: PUSH_TTL_SECONDS, timeout: SEND_TIMEOUT_MS, urgency: 'normal' })
  : null

/** Replaces the transport (used by tests). A sender rejects with an error carrying `statusCode` on HTTP failures. */
export function setPushSender(fn: PushSender | null) {
  sender = fn
}

let log: { warn: (msg: string) => void } = console

// ---- endpoint validation (SSRF guard) ---------------------------------------
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa']

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number) as [number, number]
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) || a >= 224
  )
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  // URL parsing rewrites IPv4-mapped addresses to hex groups: ::ffff:7f00:1
  const mapped = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower)
  if (mapped) {
    const hi = parseInt(mapped[1]!, 16), lo = parseInt(mapped[2]!, 16)
    return isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
  }
  const first = parseInt(lower.split(':')[0] || '0', 16)
  return (
    lower === '::' || lower === '::1' ||
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (first & 0xffc0) === 0xfe80 || // fe80::/10 link local
    (first & 0xffc0) === 0xfec0 || // fec0::/10 site local
    (first & 0xff00) === 0xff00 // multicast
  )
}

/** True when `raw` is an https URL on the default port pointing at a public hostname. */
export function isSafePushEndpoint(raw: string): boolean {
  if (raw.length > 2048) return false
  let url: URL
  try { url = new URL(raw) } catch { return false }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
  if (!host) return false
  const kind = isIP(host)
  if (kind === 4) return !isPrivateIPv4(host)
  if (kind === 6) return !isPrivateIPv6(host)
  if (!host.includes('.') || host === 'localhost') return false // single-label names resolve inside private networks
  return !BLOCKED_SUFFIXES.some((s) => host.endsWith(s))
}

const base64url = /^[A-Za-z0-9_-]+={0,2}$/
const subscribeSchema = z.object({
  endpoint: z.string().max(2048).refine(isSafePushEndpoint),
  keys: z.object({
    p256dh: z.string().min(40).max(140).regex(base64url),
    auth: z.string().min(16).max(64).regex(base64url),
  }),
})
const unsubscribeSchema = z.union([
  z.object({ endpoint: z.string().max(2048) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
])

// ---- delivery -------------------------------------------------------------
type SubscriptionRow = { id: string; endpoint: string; p256dh: string; auth: string }

// Deliberately generic: the push service and the lock screen must learn nothing about the message.
const PAYLOAD = (connectionId: string) =>
  JSON.stringify({ title: 'New message', body: 'You have a new message', data: { url: `/connections/${connectionId}` } })

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('push send timed out')), ms) })])
  } finally {
    clearTimeout(timer)
  }
}

/** Sends a content-free push to every subscription of an offline recipient. Never throws. */
export async function deliverMessagePush(e: MessageEvent): Promise<void> {
  try {
    if (!sender) return
    if (sockets.get(e.recipientId)?.size) return
    const subs = db.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(e.recipientId) as SubscriptionRow[]
    if (!subs.length) return
    const send = sender
    const payload = PAYLOAD(e.connectionId)
    await Promise.all(subs.map(async (s) => {
      try {
        await withTimeout(Promise.resolve().then(() => send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)), SEND_TIMEOUT_MS)
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id)
        } else {
          // Endpoints are bearer capabilities: log the host and status only.
          log.warn(`push delivery failed (status ${status ?? 'none'}): ${(err as Error).message?.slice(0, 120)}`)
        }
      }
    }))
  } catch (err) {
    log.warn(`push delivery error: ${(err as Error).message}`)
  }
}

// ---- routes ---------------------------------------------------------------
export async function pushRoutes(app: FastifyInstance) {
  log = app.log
  messageListeners.push((e) => { void deliverMessagePush(e) })

  app.get('/v0/push/config', authed, async () => ({ enabled: vapid !== null, publicKey: vapid?.publicKey ?? null }))

  app.post('/v0/push/subscriptions', authed, async (req, reply) => {
    if (!vapid) return reply.code(503).send({ error: 'push_disabled' })
    const body = subscribeSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' })
    const { endpoint, keys } = body.data
    const userAgent = (req.headers['user-agent'] ?? '').slice(0, 255) || null
    tx(() => {
      db.prepare(`
        INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET
          user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
          user_agent = excluded.user_agent, created_at = excluded.created_at
      `).run(newId(), req.user.sub, endpoint, keys.p256dh, keys.auth, userAgent, Date.now())
      db.prepare(`
        DELETE FROM push_subscriptions WHERE user_id = ? AND id NOT IN (
          SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?
        )
      `).run(req.user.sub, req.user.sub, MAX_SUBSCRIPTIONS_PER_USER)
    })
    return { ok: true }
  })

  app.delete('/v0/push/subscriptions', authed, async (req, reply) => {
    if (!vapid) return reply.code(503).send({ error: 'push_disabled' })
    const body = unsubscribeSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' })
    const result = 'all' in body.data
      ? db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(req.user.sub)
      : db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(req.user.sub, body.data.endpoint)
    return { ok: true, removed: Number(result.changes) }
  })
}
