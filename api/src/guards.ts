import type { FastifyReply, FastifyRequest } from 'fastify'
import { db, type UserRow } from './db.ts'

export const getUser = (id: string) =>
  db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined

/**
 * A token is only valid while its version matches the user's current `token_version` (bumped on password
 * change/reset and "sign out everywhere") and the account has not been purged.
 */
export function sessionValid(sub: string, tv: number | undefined): boolean {
  const u = db.prepare('SELECT token_version, status FROM users WHERE id = ?').get(sub) as { token_version: number; status: string } | undefined
  return !!u && u.status !== 'deleted' && u.token_version === (tv ?? 0)
}

/** Verifies the bearer JWT and that the session has not been revoked; sets req.user. */
const verifySession = async (req: FastifyRequest, reply: FastifyReply) => {
  await req.jwtVerify()
  if (!sessionValid(req.user.sub, req.user.tv)) return reply.code(401).send({ error: 'unauthorized' })
}

// A getter, not a constant array: @fastify/rate-limit appends its hook to a route's own onRequest array, and a single
// array shared by every authenticated route would hand one route's limit to all of them.
export const authed = {
  get onRequest() { return [verifySession] },
}

/**
 * Re-reads the user from the database on every call so a status/role change
 * (approval, rejection, demotion) takes effect immediately, not at token expiry.
 */
export async function requireActive(req: FastifyRequest, reply: FastifyReply) {
  const u = getUser(req.user.sub)
  if (!u) return reply.code(401).send({ error: 'unauthorized' })
  if (u.status !== 'active') return reply.code(403).send({ error: 'not_verified', status: u.status })
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  const u = getUser(req.user.sub)
  if (!u) return reply.code(401).send({ error: 'unauthorized' })
  if (u.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
}

/** Comma-separated ADMIN_EMAILS env var; matched case-insensitively. */
export const adminEmails = new Set(
  (process.env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
)
