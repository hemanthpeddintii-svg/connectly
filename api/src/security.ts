import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, hashPassword } from './db.ts'

// ---- password policy ------------------------------------------------------
const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'password1234', '12345678', '123456789', '1234567890',
  'qwertyui', 'qwerty123', 'qwertyuiop', 'iloveyou', 'letmein1', 'welcome1', 'welcome123', 'admin123', 'abc12345',
  'abcd1234', '11111111', '00000000', 'passw0rd', 'p@ssw0rd', 'changeme', 'trustno1', 'monkey123', 'dragon123',
])

/** 8..128 characters, not a well-known password, and not made of a single repeated character. */
export const passwordSchema = z.string().min(8).max(128).refine(
  (p) => !COMMON.has(p.toLowerCase()) && !/^(.)\1+$/.test(p),
  { message: 'password_too_common' },
)

/** A hash to verify against when the account doesn't exist, so response time doesn't reveal which emails are registered. */
export const DUMMY_HASH = hashPassword('not-a-real-password')

// ---- per-account sign-in throttle -----------------------------------------
// Keyed by email+IP (not email alone) so a stranger can't lock a victim out of their own account.
db.exec(`
  CREATE TABLE IF NOT EXISTS auth_throttle (
    key TEXT PRIMARY KEY,
    failures INTEGER NOT NULL,
    window_start INTEGER NOT NULL,
    locked_until INTEGER NOT NULL DEFAULT 0
  );
`)
const MAX_FAILURES = 5
const WINDOW_MS = 15 * 60 * 1000
const LOCK_MS = 15 * 60 * 1000

db.prepare('DELETE FROM auth_throttle WHERE window_start < ? AND locked_until < ?').run(Date.now() - 24 * 60 * 60 * 1000, Date.now())

/** Milliseconds until another attempt is allowed; 0 when not locked. */
export function lockRemainingMs(key: string): number {
  const row = db.prepare('SELECT locked_until FROM auth_throttle WHERE key = ?').get(key) as { locked_until: number } | undefined
  return Math.max(0, (row?.locked_until ?? 0) - Date.now())
}

// node:sqlite is synchronous, so this read-modify-write cannot interleave with another request.
export function recordFailure(key: string) {
  const now = Date.now()
  const row = db.prepare('SELECT failures, window_start FROM auth_throttle WHERE key = ?').get(key) as { failures: number; window_start: number } | undefined
  const fresh = !row || now - row.window_start > WINDOW_MS
  const failures = fresh ? 1 : row.failures + 1
  db.prepare(`
    INSERT INTO auth_throttle (key, failures, window_start, locked_until) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET failures = excluded.failures, window_start = excluded.window_start, locked_until = excluded.locked_until`,
  ).run(key, failures, fresh ? now : row.window_start, failures >= MAX_FAILURES ? now + LOCK_MS : 0)
}

export const clearFailures = (key: string) => { db.prepare('DELETE FROM auth_throttle WHERE key = ?').run(key) }

// ---- per-IP rate limits ---------------------------------------------------
/** Route options for @fastify/rate-limit. `RATE_LIMIT=off` disables it (tests only; never in production). */
export const rateLimit = (max: number, timeWindow: string) =>
  process.env.RATE_LIMIT === 'off' ? {} : { config: { rateLimit: { max, timeWindow } } }

// ---- response headers -----------------------------------------------------
export function securityHeaders(app: FastifyInstance) {
  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff')
    reply.header('x-frame-options', 'DENY')
    reply.header('referrer-policy', 'no-referrer')
    reply.header('cross-origin-resource-policy', 'same-site')
    if (process.env.NODE_ENV === 'production') reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains')
  })
}
