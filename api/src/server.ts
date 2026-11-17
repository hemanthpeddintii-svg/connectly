import Fastify, { type FastifyError } from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import websocket from '@fastify/websocket'
import rateLimitPlugin from '@fastify/rate-limit'
import { z } from 'zod'
import { STATUS_CODES } from 'node:http'
import {
  connectionClosed, db, hashPassword, newMemberId, newId, TERMS_VERSION, publicProfile, selfProfile, track, trackOnce, verifyPassword, type UserRow,
} from './db.ts'
import { adminEmails, authed, getUser, requireActive, sessionValid } from './guards.ts'
import { authRoutes } from './auth.ts'
import { DUMMY_HASH, clearFailures, lockRemainingMs, passwordSchema, rateLimit, recordFailure, securityHeaders } from './security.ts'
import { betaFull, consumeInvite, grantBetaCredits } from './features/beta.ts'
import { profileComplete } from './features/tracking.ts'
import { getSettings } from './plans.ts'
import { tx, verificationRoutes } from './verification.ts'
import { paymentRoutes } from './payments.ts'
import { requestRoutes } from './requests.ts'
import { adminRoutes } from './admin.ts'
import { featureRoutes } from './features/index.ts'
import {
  checkMessageAllowed, composeFilters, connectionFilters, errorStatus, notifyMessage, pushToUser, sockets, wallFilters,
} from './features/hooks.ts'

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-only-change-me'
if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'dev-only-change-me') {
  throw new Error('JWT_SECRET must be set in production')
}

if (process.env.NODE_ENV === 'production' && !process.env.WEB_ORIGIN) {
  throw new Error('WEB_ORIGIN must be set in production (allowed CORS origin and base URL for emailed links)')
}

// Set TRUST_PROXY=true only behind a reverse proxy you control, so rate limits see the real client IP.
// The WebSocket sends its token as ?token=, so it is hidden from request logs.
const app = Fastify({
  logger: {
    serializers: {
      req: (req) => ({ method: req.method, url: String(req.url).replace(/([?&]token=)[^&]*/g, '$1[hidden]'), host: req.host, remoteAddress: req.ip }),
    },
  },
  trustProxy: process.env.TRUST_PROXY === 'true',
})

// Unexpected failures are logged in full on the server, but callers only ever see a plain code: no messages, SQL or stack traces.
app.setErrorHandler((error: FastifyError, req, reply) => {
  const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500
  if (status >= 500) {
    req.log.error(error)
    return reply.code(status).send({ error: 'server_error' })
  }
  return reply.code(status).send({ statusCode: status, error: STATUS_CODES[status] ?? 'Bad Request', message: error.message })
})
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
await app.register(adminRoutes)

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
  city: z.string().trim().max(60).default(''),
  languages: z.array(z.string().trim().min(1).max(30)).max(8).default([]),
  lookingFor: z.string().trim().max(300).default(''),
  agreeToTerms: z.literal(true),
  inviteCode: z.string().trim().max(40).optional(),
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
  class Refused extends Error {}
  let source: { kind: string; ref: string | null } = { kind: 'direct', ref: null }
  let out = 'ok' as 'ok' | 'invite_invalid' | 'beta_full'
  try {
    tx(() => {
      // Invite-only: a missing, unknown or used-up code is refused. When not invite-only, a valid code is still honored.
      // Errors are thrown so the transaction (including the consumed invite use) rolls back.
      let invitedBy: string | null = null
      source = { kind: 'direct', ref: null }
      if (!isAdmin) {
        const invite = d.inviteCode ? consumeInvite(d.inviteCode) : 'invalid'
        if (invite === 'invalid') {
          if (getSettings().invite_only) { out = 'invite_invalid'; throw new Refused() }
        } else { invitedBy = invite.ownerId; source = { kind: invite.kind, ref: invite.ref } }
        if (betaFull(d.gender)) { out = 'beta_full'; throw new Refused() }
      }
      db.prepare(
        'INSERT INTO users (id,member_id,email,password_hash,name,age,bio,interests,gender,status,role,created_at,city,languages,looking_for,terms_agreed_at,terms_version,invited_by,source_kind,source_ref) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ).run(
        id, newMemberId(), email, hashPassword(d.password), d.name, d.age, d.bio, JSON.stringify(d.interests), d.gender,
        isAdmin ? 'active' : 'unverified', isAdmin ? 'admin' : 'user', Date.now(), d.city, JSON.stringify(d.languages), d.lookingFor, Date.now(), TERMS_VERSION,
        invitedBy, source.kind, source.ref,
      )
      if (d.gender === 'man' && !isAdmin) grantBetaCredits(id)
    })
  } catch (e) {
    if (!(e instanceof Refused)) throw e
  }
  if (out === 'invite_invalid') return reply.code(400).send({ error: 'invite_invalid' })
  if (out === 'beta_full') return reply.code(409).send({ error: 'beta_full' })
  const user = getUser(id)!
  track('signup', id, { gender: d.gender, source: source.kind })
  track('terms_agreed', id)
  if (source.kind !== 'direct') track('invite_used', id, { kind: source.kind })
  if (profileComplete(user)) trackOnce('profile_completed', id)
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
  track('login', user.id)
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
    city: z.string().trim().max(60).optional(),
    languages: z.array(z.string().trim().min(1).max(30)).max(8).optional(),
    lookingFor: z.string().trim().max(300).optional(),
  }).safeParse(req.body)
  if (!body.success) return reply.code(400).send({ error: 'invalid_input' })
  const u = getUser(req.user.sub)
  if (!u) return reply.code(401).send({ error: 'unauthorized' })
  // Gender decides which side of a request a member is on, so it can be set once (accounts that predate it) and never switched.
  if (body.data.gender && u.gender && body.data.gender !== u.gender) return reply.code(409).send({ error: 'gender_locked' })
  if (body.data.gender && !u.gender) {
    const g = body.data.gender
    const full = tx(() => {
      if (betaFull(g)) return true
      db.prepare('UPDATE users SET gender = ? WHERE id = ?').run(g, u.id)
      if (g === 'man') grantBetaCredits(u.id)
      return false
    })
    if (full) return reply.code(409).send({ error: 'beta_full' })
  }
  db.prepare('UPDATE users SET name=?, bio=?, interests=?, city=?, languages=?, looking_for=? WHERE id=?').run(
    body.data.name ?? u.name,
    body.data.bio ?? u.bio,
    body.data.interests ? JSON.stringify(body.data.interests) : u.interests,
    body.data.city ?? u.city,
    body.data.languages ? JSON.stringify(body.data.languages) : u.languages,
    body.data.lookingFor ?? u.looking_for,
    u.id,
  )
  const after = getUser(u.id)!
  if (profileComplete(after)) trackOnce('profile_completed', u.id)
  return selfProfile(after)
})

app.post('/v0/me/agree-terms', authed, async (req, reply) => {
  const u = getUser(req.user.sub)
  if (!u) return reply.code(401).send({ error: 'unauthorized' })
  // Agreeing again to a newer version replaces the record; agreeing to the current version twice changes nothing.
  if (u.terms_version !== TERMS_VERSION || u.terms_agreed_at == null) {
    db.prepare('UPDATE users SET terms_agreed_at = ?, terms_version = ? WHERE id = ?').run(Date.now(), TERMS_VERSION, u.id)
  }
  trackOnce('terms_agreed', u.id)
  return { termsAgreed: true }
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
  const body = z.object({ memberId: z.string(), action: z.literal('skip') }).safeParse(req.body)
  if (!body.success) return reply.code(400).send({ error: 'invalid_input' })
  const target = db.prepare('SELECT * FROM users WHERE member_id = ?').get(body.data.memberId) as UserRow | undefined
  if (!target || target.id === req.user.sub || target.status !== 'active') return reply.code(404).send({ error: 'not_found' })
  db.prepare(
    "INSERT INTO actions (from_id,to_id,action,created_at) VALUES (?,?,'skip',?) ON CONFLICT(from_id,to_id) DO UPDATE SET action='skip', created_at=excluded.created_at",
  ).run(req.user.sub, target.id, Date.now())
  return {}
})

// Members the viewer said "Not now" to, newest first, so a skip is never final. Same safety filters as the community list
// (blocked, deactivated and suspended members stay hidden); anyone already sent a request is left out.
app.get('/v0/profiles/skipped', active, async (req, reply) => {
  if (getUser(req.user.sub)?.gender !== 'man') return reply.code(403).send({ error: 'not_applicable' })
  const extra = composeFilters(wallFilters, req.user.sub)
  const rows = db.prepare(`
    SELECT u.*, a.created_at AS skipped_at FROM actions a JOIN users u ON u.id = a.to_id
    WHERE a.from_id = ? AND a.action = 'skip' AND u.status = 'active' AND u.gender = 'woman'
      AND NOT EXISTS (SELECT 1 FROM requests r WHERE r.from_id = ? AND r.to_id = u.id)${extra.sql}
    ORDER BY a.created_at DESC LIMIT 100`).all(req.user.sub, req.user.sub, ...extra.params) as Array<UserRow & { skipped_at: number }>
  return rows.map((u) => ({ ...publicProfile(u), skippedAt: u.skipped_at }))
})

// Undo a "Not now": the member goes back into the viewer's community list.
app.delete('/v0/actions/:memberId', active, async (req, reply) => {
  const { memberId } = req.params as { memberId: string }
  const target = db.prepare('SELECT id FROM users WHERE member_id = ?').get(memberId) as { id: string } | undefined
  if (!target) return reply.code(404).send({ error: 'not_found' })
  const r = db.prepare("DELETE FROM actions WHERE from_id = ? AND to_id = ? AND action = 'skip'").run(req.user.sub, target.id)
  if (r.changes === 0) return reply.code(404).send({ error: 'not_found' })
  return {}
})

// ---- connections & chat -------------------------------------------------
app.get('/v0/connections', active, async (req) => {
  const extra = composeFilters(connectionFilters, req.user.sub)
  // Columns of c and lm are aliased: u.* also carries id and created_at, and duplicate names would silently return the wrong id.
  const rows = db.prepare(`
    SELECT c.id AS connection_id, c.created_at AS connected_at, c.closed_at AS closed_at, c.closed_by AS closed_by, c.close_kind AS close_kind, u.*,
      lm.sender_id AS lm_sender, lm.kind AS lm_kind, lm.body AS lm_body, lm.created_at AS lm_at,
      (SELECT COUNT(*) FROM messages m WHERE m.connection_id = c.id AND m.sender_id != ?
         AND m.created_at > COALESCE((SELECT r.last_read_at FROM message_reads r WHERE r.connection_id = c.id AND r.user_id = ?), 0)) AS unread_count
    FROM connections c
    JOIN users u ON u.id = CASE WHEN c.a_id = ? THEN c.b_id ELSE c.a_id END
    LEFT JOIN messages lm ON lm.id = (SELECT m2.id FROM messages m2 WHERE m2.connection_id = c.id ORDER BY m2.created_at DESC, m2.rowid DESC LIMIT 1)
    WHERE (c.a_id = ? OR c.b_id = ?)${extra.sql}
    ORDER BY COALESCE(lm.created_at, c.created_at) DESC`).all(
    req.user.sub, req.user.sub, req.user.sub, req.user.sub, req.user.sub, ...extra.params) as any[]
  return rows.map((r) => ({
    id: r.connection_id as string,
    createdAt: r.connected_at as number,
    profile: publicProfile(r),
    lastMessage: r.lm_at == null ? null : {
      preview: r.lm_kind === 'voice' ? 'Voice message' : r.lm_kind === 'image' ? 'Photo' : String(r.lm_body).slice(0, 140),
      kind: r.lm_kind as 'text' | 'voice' | 'image',
      mine: r.lm_sender === req.user.sub,
      createdAt: r.lm_at as number,
    },
    unread: r.unread_count as number,
    closed: r.closed_at == null ? null : { at: r.closed_at as number, byMe: r.closed_by === req.user.sub, kind: (r.close_kind ?? 'kind') as 'offline' | 'kind' },
  }))
})

// Close a chat kindly. Either member can; it is final, the history stays readable, and nobody can send more.
// "offline" = we are moving on from the app; "kind" = not the right fit. The other member only sees a gentle note for the kind chosen, never a reason.
app.post('/v0/connections/:id/close', active, async (req, reply) => {
  const { id } = req.params as { id: string }
  const body = z.object({ kind: z.enum(['offline', 'kind']) }).safeParse(req.body)
  if (!body.success) return reply.code(400).send({ error: 'invalid_input' })
  const c = isMember(id, req.user.sub)
  if (!c || (c.a_id !== req.user.sub && c.b_id !== req.user.sub)) return reply.code(404).send({ error: 'not_found' })
  if (!connectionClosed(id)) {
    db.prepare('UPDATE connections SET closed_at = ?, closed_by = ?, close_kind = ? WHERE id = ?').run(Date.now(), req.user.sub, body.data.kind, id)
    track('chat_closed', req.user.sub, { kind: body.data.kind })
  }
  return { ok: true }
})

const isMember = (connId: string, userId: string) =>
  db.prepare('SELECT a_id, b_id FROM connections WHERE id=?').get(connId) as { a_id: string; b_id: string } | undefined

app.post('/v0/connections/:id/read', active, async (req, reply) => {
  const { id } = req.params as { id: string }
  const c = isMember(id, req.user.sub)
  if (!c || (c.a_id !== req.user.sub && c.b_id !== req.user.sub)) return reply.code(404).send({ error: 'not_found' })
  db.prepare(
    'INSERT INTO message_reads (connection_id,user_id,last_read_at) VALUES (?,?,?) ON CONFLICT(connection_id,user_id) DO UPDATE SET last_read_at=excluded.last_read_at',
  ).run(id, req.user.sub, Date.now())
  return { ok: true }
})

/** How long a member can edit a text message after sending it. */
const EDIT_WINDOW_MS = 15 * 60_000

type MessageRow = {
  id: string; sender_id: string; body: string; kind: string; attachment_mime: string | null; attachment_duration_ms: number | null
  created_at: number; edited_at: number | null; reply_to_id: string | null; r_sender: string | null; r_body: string | null; r_kind: string | null
}
const MESSAGE_SELECT = `SELECT m.id, m.sender_id, m.body, m.kind, m.attachment_mime, m.attachment_duration_ms, m.created_at, m.edited_at, m.reply_to_id,
  r.sender_id AS r_sender, r.body AS r_body, r.kind AS r_kind
  FROM messages m LEFT JOIN messages r ON r.id = m.reply_to_id AND r.connection_id = m.connection_id`

/** The message as one member sees it: who wrote it, whether it was edited, and a short preview of what it replies to. */
function messageView(m: MessageRow, viewerId: string) {
  const replyTo = m.reply_to_id && m.r_sender
    ? { id: m.reply_to_id, mine: m.r_sender === viewerId, kind: m.r_kind as 'text' | 'image' | 'voice',
        preview: m.r_kind === 'voice' ? 'Voice message' : m.r_kind === 'image' ? 'Photo' : (m.r_body ?? '').slice(0, 120) }
    : null
  return {
    id: m.id, mine: m.sender_id === viewerId, kind: m.kind as 'text' | 'image' | 'voice', body: m.body,
    attachmentMime: m.attachment_mime, attachmentDurationMs: m.attachment_duration_ms, createdAt: m.created_at,
    editedAt: m.edited_at, replyTo,
  }
}

app.get('/v0/connections/:id/messages', active, async (req, reply) => {
  const { id } = req.params as { id: string }
  const c = isMember(id, req.user.sub)
  if (!c || (c.a_id !== req.user.sub && c.b_id !== req.user.sub)) return reply.code(404).send({ error: 'not_found' })
  const before = Number((req.query as any).before) || Number.MAX_SAFE_INTEGER
  const rows = db.prepare(`${MESSAGE_SELECT} WHERE m.connection_id=? AND m.created_at<? ORDER BY m.created_at DESC LIMIT 50`).all(id, before) as MessageRow[]
  return rows.reverse().map((m) => messageView(m, req.user.sub))
})

app.post('/v0/connections/:id/messages', active, async (req, reply) => {
  const { id } = req.params as { id: string }
  const body = z.object({ body: z.string().trim().min(1).max(2000), replyToId: z.string().max(64).optional() }).safeParse(req.body)
  if (!body.success) return reply.code(400).send({ error: 'invalid_input' })
  const c = isMember(id, req.user.sub)
  if (!c || (c.a_id !== req.user.sub && c.b_id !== req.user.sub)) return reply.code(404).send({ error: 'not_found' })
  // Chat is free once a request is accepted; sending still has to pass every registered guard (blocks, suspensions, deactivation).
  const other = c.a_id === req.user.sub ? c.b_id : c.a_id
  if (connectionClosed(id)) return reply.code(409).send({ error: 'chat_closed' })
  const refused = checkMessageAllowed(getUser(req.user.sub)!, other)
  if (refused) return reply.code(errorStatus(refused)).send({ error: refused })
  // A reply must point at a message in this same conversation.
  const replyToId = body.data.replyToId ?? null
  if (replyToId && !db.prepare('SELECT 1 FROM messages WHERE id = ? AND connection_id = ?').get(replyToId, id)) {
    return reply.code(400).send({ error: 'invalid_reply' })
  }
  const firstMessage = !db.prepare('SELECT 1 FROM messages WHERE connection_id = ? LIMIT 1').get(id)
  const msgId = newId(), createdAt = Date.now()
  db.prepare('INSERT INTO messages (id,connection_id,sender_id,body,created_at,reply_to_id) VALUES (?,?,?,?,?,?)')
    .run(msgId, id, req.user.sub, body.data.body, createdAt, replyToId)
  const row = db.prepare(`${MESSAGE_SELECT} WHERE m.id = ?`).get(msgId) as MessageRow
  pushToUser(other, { type: 'message', connectionId: id, message: messageView(row, other) })
  if (firstMessage) track('chat_started', req.user.sub, { connectionId: id })
  track('message_sent', req.user.sub, { kind: 'text', reply: !!replyToId })
  notifyMessage({ connectionId: id, senderId: req.user.sub, recipientId: other, preview: body.data.body })
  return messageView(row, req.user.sub)
})

// Edit your own text message for a short while after sending it. The other person sees "edited"; no new notification is sent.
app.patch('/v0/connections/:id/messages/:messageId', active, async (req, reply) => {
  const { id, messageId } = req.params as { id: string; messageId: string }
  const body = z.object({ body: z.string().trim().min(1).max(2000) }).safeParse(req.body)
  if (!body.success) return reply.code(400).send({ error: 'invalid_input' })
  const c = isMember(id, req.user.sub)
  if (!c || (c.a_id !== req.user.sub && c.b_id !== req.user.sub)) return reply.code(404).send({ error: 'not_found' })
  const other = c.a_id === req.user.sub ? c.b_id : c.a_id
  if (connectionClosed(id)) return reply.code(409).send({ error: 'chat_closed' })
  const refused = checkMessageAllowed(getUser(req.user.sub)!, other)
  if (refused) return reply.code(errorStatus(refused)).send({ error: refused })
  const m = db.prepare('SELECT sender_id, kind, created_at FROM messages WHERE id = ? AND connection_id = ?').get(messageId, id) as
    { sender_id: string; kind: string; created_at: number } | undefined
  if (!m) return reply.code(404).send({ error: 'not_found' })
  if (m.sender_id !== req.user.sub) return reply.code(403).send({ error: 'not_yours' })
  if (m.kind !== 'text') return reply.code(400).send({ error: 'not_editable' })
  if (Date.now() - m.created_at > EDIT_WINDOW_MS) return reply.code(409).send({ error: 'edit_window_closed' })
  db.prepare('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?').run(body.data.body, Date.now(), messageId)
  const row = db.prepare(`${MESSAGE_SELECT} WHERE m.id = ?`).get(messageId) as MessageRow
  pushToUser(other, { type: 'message', connectionId: id, message: messageView(row, other) })
  track('message_edited', req.user.sub, {})
  return messageView(row, req.user.sub)
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
