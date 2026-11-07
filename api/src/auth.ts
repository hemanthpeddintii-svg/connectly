import type { FastifyInstance } from 'fastify'
import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { db, hashPassword, selfProfile, verifyPassword, type UserRow } from './db.ts'
import { authed, getUser } from './guards.ts'
import { disconnectUser } from './features/hooks.ts'
import { sendMail } from './mailer.ts'
import { clearFailures, lockRemainingMs, passwordSchema, rateLimit, recordFailure } from './security.ts'
import { tx } from './verification.ts'

const RESET_TTL_MS = 30 * 60 * 1000
const APP_URL = (process.env.WEB_ORIGIN ?? 'http://localhost:5173').replace(/\/$/, '')
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

export async function authRoutes(app: FastifyInstance) {
  const sign = (u: UserRow) => app.jwt.sign({ sub: u.id, tv: u.token_version }, { expiresIn: '30d' })
  const invalid = (issues: z.core.$ZodIssue[]) => ({ error: 'invalid_input', issues })

  /** Ends every existing session for the user (all tokens, live sockets) by bumping the token version. */
  const revokeSessions = (userId: string) => {
    db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(userId)
    disconnectUser(userId)
  }

  // ---- signed-in --------------------------------------------------------
  app.post('/v0/logout-all', authed, async (req) => {
    revokeSessions(req.user.sub)
    return { ok: true }
  })

  app.post('/v0/password/change', { ...authed, ...rateLimit(10, '1 minute') }, async (req, reply) => {
    const body = z.object({ currentPassword: z.string().max(200), newPassword: passwordSchema }).safeParse(req.body)
    if (!body.success) return reply.code(400).send(invalid(body.error.issues))
    const user = getUser(req.user.sub)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })

    // Guessing the current password from a stolen session is throttled like a login.
    const key = `pwchange|${user.id}`
    const wait = lockRemainingMs(key)
    if (wait > 0) {
      const retryAfterSeconds = Math.ceil(wait / 1000)
      return reply.code(429).header('retry-after', String(retryAfterSeconds)).send({ error: 'too_many_attempts', retryAfterSeconds })
    }
    // 403, not 401: the session itself is fine, and clients treat 401 as "signed out".
    if (!verifyPassword(body.data.currentPassword, user.password_hash)) {
      recordFailure(key)
      return reply.code(403).send({ error: 'wrong_password' })
    }
    clearFailures(key)
    if (body.data.newPassword === body.data.currentPassword) return reply.code(400).send({ error: 'same_password' })

    tx(() => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.data.newPassword), user.id)
      db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id)
    })
    revokeSessions(user.id)
    // Every other device is signed out; this one continues with a fresh token.
    const fresh = getUser(user.id)!
    return { token: sign(fresh), user: selfProfile(fresh) }
  })

  // ---- signed-out: forgot / reset ----------------------------------------
  app.post('/v0/password/forgot', rateLimit(5, '15 minutes'), async (req, reply) => {
    const body = z.object({ email: z.string().email().max(254) }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' })
    const email = body.data.email.toLowerCase()

    // The reply is identical whether or not the account exists, and mail is not awaited, so neither content nor timing leaks it.
    const key = `forgot|${email}`
    if (lockRemainingMs(key) === 0) {
      recordFailure(key) // reused as a counter: at most 5 emails per address per 15 minutes
      const user = db.prepare("SELECT * FROM users WHERE email = ? AND status != 'deleted'").get(email) as UserRow | undefined
      if (user) {
        const token = randomBytes(32).toString('base64url')
        tx(() => {
          db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id) // only the newest link works
          db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)')
            .run(sha256(token), user.id, Date.now() + RESET_TTL_MS, Date.now())
        })
        void sendMail({
          to: user.email,
          subject: 'Reset your Connectly password',
          text: `Use this link within 30 minutes to choose a new password:\n\n${APP_URL}/reset-password?token=${token}\n\nIf you didn't ask for this, ignore this email; your password won't change.`,
        })
      }
    }
    return reply.code(202).send({ ok: true })
  })

  app.post('/v0/password/reset', rateLimit(10, '15 minutes'), async (req, reply) => {
    const body = z.object({ token: z.string().min(20).max(200), newPassword: passwordSchema }).safeParse(req.body)
    if (!body.success) return reply.code(400).send(invalid(body.error.issues))

    // Only a hash of the token is stored, so a database leak doesn't hand out working reset links.
    const row = db.prepare('SELECT user_id, expires_at FROM password_resets WHERE token_hash = ?').get(sha256(body.data.token)) as { user_id: string; expires_at: number } | undefined
    if (!row || row.expires_at < Date.now()) {
      if (row) db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(row.user_id)
      return reply.code(400).send({ error: 'invalid_or_expired_token' })
    }
    tx(() => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.data.newPassword), row.user_id)
      db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(row.user_id) // single use
    })
    revokeSessions(row.user_id)
    return { ok: true }
  })
}
