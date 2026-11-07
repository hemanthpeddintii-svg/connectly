import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import websocket from '@fastify/websocket'
import rateLimitPlugin from '@fastify/rate-limit'
import { z } from 'zod'
import type { WebSocket } from 'ws'
import {
  db, hashPassword, newBumpId, newId, publicProfile, selfProfile, verifyPassword, type UserRow,
} from './db.ts'
import { adminEmails, authed, getUser, requireActive, sessionValid } from './guards.ts'
import { authRoutes } from './auth.ts'
import { DUMMY_HASH, clearFailures, lockRemainingMs, passwordSchema, rateLimit, recordFailure, securityHeaders } from './security.ts'
import { verificationRoutes } from './verification.ts'
import { paymentRoutes } from './payments.ts'
import { requestRoutes } from './requests.ts'
import { featureRoutes } from './features/index.ts'
import {
  actionGuards, checkMessageAllowed, composeFilters, connectionFilters, errorStatus, notifyMessage, pushToUser, sockets, wallFilters,
} from './features/hooks.ts'

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-only-change-me'
if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'dev-only-change-me') {
  throw new Error('JWT_SECRET must be set in production')
}

if (process.env.NODE_ENV === 'production' && !process.env.WEB_ORIGIN) {
  throw new Error('WEB_ORIGIN must be set in production (allowed CORS origin and base URL for emailed links)')
}

// Set TRUST_PROXY=true only behind a reverse proxy you control, so rate limits see the real client IP.
const app = Fastify({ logger: true, trustProxy: process.env.TRUST_PROXY === 'true' })
securityHeaders(app)
await app.register(cors, { origin: process.env.WEB_ORIGIN ?? true })
await app.register(rateLimitPlugin, { global: false })
await app.register(jwt, { secret: JWT_SECRET })
await app.register(websocket)

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; tv?: number }
    user: { sub: string; tv?: number }
  }
}

await app.register(authRoutes)
await app.register(verificationRoutes)
await app.register(paymentRoutes)
await app.register(featureRoutes)
await app.register(requestRoutes)

// Accounts listed in ADMIN_EMAILS are admins and skip verification.
for (const email of adminEmails) {
  db.prepare("UPDATE users SET role='admin', status='active' WHERE email = ?").run(email)
}

const active = { ...authed, preHandler: [requireActive] }
const sign = (u: UserRow) => app.jwt.sign({ sub: u.id, tv: u.token_version }, { expiresIn: '30d' })

// ---- auth ---------------------------------------------------------------
const signupSchema = z.object({
  email: z.string().email().max(254),
  password: passwordSchema,
  gender: z.enum(['man', 'woman']),
  name: z.string().trim().min(1).max(60),
  age: z.number().int().min(18).max(120),
  bio: z.string().max(500).default(''),
  interests: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
})

app.post('/v0/signup', rateLimit(10, '1 hour'), async (req, reply) => {
  const body = signupSchema.safeParse(req.body)
  if (!body.success) return reply.code(400).send({ error: 'invalid_input', issues: body.error.issues })
  const d = body.data
  const email = d.email.toLowerCase()
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return reply.code(409).send({ error: 'email_taken' })
  }
  const id = newId()
  const isAdmin = adminEmails.has(email)
  db.prepare(
    'INSERT INTO users (id,bump_id,email,password_hash,name,age,bio,interests,gender,status,role,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    id, newBumpId(), email, hashPassword(d.password), d.name, d.age, d.bio, JSON.stringify(d.interests), d.gender,
    isAdmin ? 'active' : 'unverified', isAdmin ? 'admin' : 'user', Date.now(),
  )
  const user = getUser(id)!
  return { token: sign(user), user: selfProfile(user) }
})

app.post('/v0/login', rateLimit(20, '1 minute'), async (req, reply) => {
  const body = z.object({ email: z.string().email().max(254), password: z.string().max(200) }).safeParse(req.body)
  if (!body.success) return reply.code(400).send({ error: 'invalid_input' })
  const email = body.data.email.toLowerCase()
  const key = `login|${email}|${req.ip}`
  const wait = lockRemainingMs(key)
  if (wait > 0) {
    const retryAfterSeconds = Math.ceil(wait / 1000)
    return reply.code(429).header('retry-after', String(retryAfterSeconds)).send({ error: 'too_many_attempts', retryAfterSeconds })
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined
  // Always run one hash verification, and answer identically, so neither timing nor the reply reveals whether the email exists.
  const ok = verifyPassword(body.data.password, user?.password_hash ?? DUMMY_HASH)
  if (!user || !ok) {
    recordFailure(key)
    return reply.code(401).send({ error: 'invalid_credentials' })
  }
  clearFailures(key)
  return { token: sign(user), user: selfProfile(user) }
})

// ---- me -----------------------------------------------------------------
app.get('/v0/me', authed, async (req, reply) => {
  const user = getUser(req.user.sub)
  if (!user) return reply.code(401).send({ error: 'unauthorized' })
  return selfProfile(user)
})

app.patch('/v0/me', authed, async (req, reply) => {
  const body = z.object({
    name: z.string().trim().min(1).max(60).optional(),
    bio: z.string().max(500).optional(),
    interests: z.array(z.string().trim().min(1).max(30)).max(12).optional(),
    gender: z.enum(['man', 'woman']).optional(),
  }).safeParse(req.body)
  if (!body.success) return reply.code(400).send({ error: 'invalid_input' })
  const u = getUser(req.user.sub)
  if (!u) return reply.code(401).send({ error: 'unauthorized' })
  // Gender decides which side of a request a member is on, so it can be set once (accounts that predate it) and never switched.
  if (body.data.gender && u.gender && body.data.gender !== u.gender) return reply.code(409).send({ error: 'gender_locked' })
  if (body.data.gender && !u.gender) db.prepare('UPDATE users SET gender = ? WHERE id = ?').run(body.data.gender, u.id)
  db.prepare('UPDATE users SET name=?, bio=?, interests=? WHERE id=?').run(
    body.data.name ?? u.name,
    body.data.bio ?? u.bio,
    body.data.interests ? JSON.stringify(body.data.interests) : u.interests,
    u.id,
  )
  return selfProfile(getUser(u.id)!)
})

// ---- wall & actions -----------------------------------------------------
app.get('/v0/profiles', active, async (req, reply) => {
  // Only men browse; they see women who haven't been answered yet.
  if (getUser(req.user.sub)?.gender !== 'man') return reply.code(403).send({ error: 'not_applicable' })
  const limit = Math.min(Number((req.query as any).limit) || 20, 50)
  const extra = composeFilters(wallFilters, req.user.sub)
  const rows = db.prepare(`
    SELECT * FROM users u
    WHERE u.id != ? AND u.status = 'active' AND u.gender = 'woman'
      AND NOT EXISTS (SELECT 1 FROM actions a WHERE a.from_id = ? AND a.to_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM requests r WHERE r.from_id = ? AND r.to_id = u.id)${extra.sql}
    ORDER BY u.created_at DESC LIMIT ?`).all(req.user.sub, req.user.sub, req.user.sub, ...extra.params, limit) as UserRow[]
  return rows.map(publicProfile)
})

// "Not now" on a community card hides that member from the viewer's list. Introductions go through /v0/requests.
app.post('/v0/actions', active, async (req, reply) => {
  const body = z.object({ bumpId: z.string(), action: z.literal('skip') }).safeParse(req.body)
  if (!body.success) return reply.code(400).send({ error: 'invalid_input' })
  const target = db.prepare('SELECT * FROM users WHERE bump_id = ?').get(body.data.bumpId) as UserRow | undefined
  if (!target || target.id === req.user.sub || target.status !== 'active') return reply.code(404).send({ error: 'not_found' })
  db.prepare(
    "INSERT INTO actions (from_id,to_id,action,created_at) VALUES (?,?,'skip',?) ON CONFLICT(from_id,to_id) DO UPDATE SET action='skip', created_at=excluded.created_at",
  ).run(req.user.sub, target.id, Date.now())
  return {}
})

// ---- connections & chat -------------------------------------------------
app.get('/v0/connections', active, async (req) => {
  const extra = composeFilters(connectionFilters, req.user.sub)
  const rows = db.prepare(`
    SELECT c.id AS connection_id, c.created_at AS connected_at, u.* FROM connections c
    JOIN users u ON u.id = CASE WHEN c.a_id = ? THEN c.b_id ELSE c.a_id END
    WHERE (c.a_id = ? OR c.b_id = ?)${extra.sql} ORDER BY c.created_at DESC`).all(req.user.sub, req.user.sub, req.user.sub, ...extra.params) as any[]
  return rows.map((r) => ({ id: r.connection_id as string, createdAt: r.connected_at as number, profile: publicProfile(r) }))
})

const isMember = (connId: string, userId: string) =>
  db.prepare('SELECT a_id, b_id FROM connections WHERE id=?').get(connId) as { a_id: string; b_id: string } | undefined

app.get('/v0/connections/:id/messages', active, async (req, reply) => {
  const { id } = req.params as { id: string }
  const c = isMember(id, req.user.sub)
  if (!c || (c.a_id !== req.user.sub && c.b_id !== req.user.sub)) return reply.code(404).send({ error: 'not_found' })
  const before = Number((req.query as any).before) || Number.MAX_SAFE_INTEGER
  const rows = db.prepare(
    'SELECT id, sender_id, body, kind, attachment_mime, attachment_duration_ms, created_at FROM messages WHERE connection_id=? AND created_at<? ORDER BY created_at DESC LIMIT 50',
  ).all(id, before) as any[]
  return rows.reverse().map((m) => ({
    id: m.id, mine: m.sender_id === req.user.sub, kind: m.kind as 'text' | 'image' | 'voice', body: m.body,
    attachmentMime: m.attachment_mime as string | null, attachmentDurationMs: m.attachment_duration_ms as number | null, createdAt: m.created_at,
  }))
})

app.post('/v0/connections/:id/messages', active, async (req, reply) => {
  const { id } = req.params as { id: string }
  const body = z.object({ body: z.string().trim().min(1).max(2000) }).safeParse(req.body)
  if (!body.success) return reply.code(400).send({ error: 'invalid_input' })
  const c = isMember(id, req.user.sub)
  if (!c || (c.a_id !== req.user.sub && c.b_id !== req.user.sub)) return reply.code(404).send({ error: 'not_found' })
  // Chat is free once a request is accepted; sending still has to pass every registered guard (blocks, suspensions, deactivation).
  const other = c.a_id === req.user.sub ? c.b_id : c.a_id
  const refused = checkMessageAllowed(getUser(req.user.sub)!, other)
  if (refused) return reply.code(errorStatus(refused)).send({ error: refused })
  const msg = { id: newId(), createdAt: Date.now() }
  db.prepare('INSERT INTO messages (id,connection_id,sender_id,body,created_at) VALUES (?,?,?,?,?)')
    .run(msg.id, id, req.user.sub, body.data.body, msg.createdAt)
  pushToUser(other, {
    type: 'message', connectionId: id,
    message: { id: msg.id, mine: false, kind: 'text', body: body.data.body, attachmentMime: null, attachmentDurationMs: null, createdAt: msg.createdAt },
  })
  notifyMessage({ connectionId: id, senderId: req.user.sub, recipientId: other, preview: body.data.body })
  return { id: msg.id, mine: true, kind: 'text', body: body.data.body, attachmentMime: null, attachmentDurationMs: null, createdAt: msg.createdAt }
})

// Browsers can't set headers on WebSocket, so the JWT arrives as ?token=.
app.get('/v0/ws', { websocket: true }, (socket, req) => {
  let userId: string
  try {
    const token = (req.query as any).token as string
    const payload = app.jwt.verify(token) as { sub: string; tv?: number }
    if (!sessionValid(payload.sub, payload.tv)) throw new Error('revoked')
    userId = payload.sub
  } catch {
    socket.close(4401, 'unauthorized')
    return
  }
  const set = sockets.get(userId) ?? new Set()
  set.add(socket)
  sockets.set(userId, set)
  socket.on('close', () => set.delete(socket))
})

app.get('/health', async () => ({ ok: true }))

const port = Number(process.env.PORT ?? 3001)
await app.listen({ port, host: '127.0.0.1' })
