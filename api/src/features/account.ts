import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { db } from '../db.ts'
import { authed, getUser } from '../guards.ts'
import { actionGuards, connectionFilters, messageGuards, wallFilters } from './hooks.ts'

/**
 * Per-member account controls.
 *  - quiet_until: epoch ms. Hidden from other members' wall while in the future (checked on read, no timers).
 *    QUIET_FOREVER is the sentinel for "until I turn it off".
 *  - deactivated_at: set while the account is deactivated.
 *  - delete_requested_at: start of the 30-day grace period (see GRACE_MS); the purge script acts on it.
 *  - delete_reason: optional free text from the member, cleared on cancel and on purge.
 *  - purged_at: set by the purge script once the account has been anonymised.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS account_state (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    quiet_until INTEGER,
    deactivated_at INTEGER,
    delete_requested_at INTEGER,
    delete_reason TEXT,
    purged_at INTEGER
  )
`)

export const GRACE_MS = 30 * 24 * 60 * 60 * 1000
/** 8.64e15 ms is the largest value a JavaScript Date can represent; used as "no end date". */
export const QUIET_FOREVER = 8_640_000_000_000_000
const HOUR_MS = 60 * 60 * 1000

type StateRow = { quiet_until: number | null; deactivated_at: number | null; delete_requested_at: number | null }

function stateOf(userId: string) {
  const row = db.prepare('SELECT quiet_until, deactivated_at, delete_requested_at FROM account_state WHERE user_id = ?')
    .get(userId) as StateRow | undefined
  const requested = row?.delete_requested_at ?? null
  return {
    quietUntil: row?.quiet_until != null && row.quiet_until > Date.now() ? row.quiet_until : null,
    deactivated: row?.deactivated_at != null,
    deleteRequestedAt: requested,
    deletionDueAt: requested === null ? null : requested + GRACE_MS,
  }
}

// A deleted (anonymised) account may still hold an unexpired token; it must not be able to act.
async function notPurged(req: FastifyRequest, reply: FastifyReply) {
  if (!getUser(req.user.sub)) return reply.code(401).send({ error: 'unauthorized' })
  const purged = db.prepare('SELECT 1 FROM account_state WHERE user_id = ? AND purged_at IS NOT NULL').get(req.user.sub)
  if (purged) return reply.code(401).send({ error: 'unauthorized' })
}

const manage = { ...authed, preHandler: [notPurged] }

const quietSchema = z.object({ hours: z.number().int().min(1).max(720).optional() }).optional()
const deleteSchema = z.object({
  reason: z.string().trim().max(300).optional(),
}).optional()

/** Deactivated or quiet members are not shown to others. */
const isHidden = (userId: string) =>
  db.prepare(`SELECT 1 FROM account_state WHERE user_id = ? AND (deactivated_at IS NOT NULL OR quiet_until > ?)`)
    .get(userId, Date.now()) !== undefined
const isDeactivated = (userId: string) =>
  db.prepare('SELECT 1 FROM account_state WHERE user_id = ? AND deactivated_at IS NOT NULL').get(userId) !== undefined

export async function accountRoutes(app: FastifyInstance) {
  wallFilters.push(() => ({
    sql: `NOT EXISTS (SELECT 1 FROM account_state s WHERE s.user_id = u.id AND (s.deactivated_at IS NOT NULL OR s.quiet_until > ?))`,
    params: [Date.now()],
  }))
  connectionFilters.push(() => ({
    sql: 'NOT EXISTS (SELECT 1 FROM account_state s WHERE s.user_id = u.id AND s.deactivated_at IS NOT NULL)',
    params: [],
  }))
  actionGuards.push((fromId, target) => {
    if (isDeactivated(fromId)) return 'account_deactivated'
    return isHidden(target.id) ? 'not_found' : null
  })
  messageGuards.push((sender, otherId) => {
    if (isDeactivated(sender.id)) return 'account_deactivated'
    return isDeactivated(otherId) ? 'not_found' : null
  })

  app.get('/v0/account', manage, async (req) => stateOf(req.user.sub))

  app.post('/v0/account/quiet-mode', manage, async (req, reply) => {
    const body = quietSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' })
    const hours = body.data?.hours
    const until = hours === undefined ? QUIET_FOREVER : Date.now() + hours * HOUR_MS
    db.prepare('INSERT INTO account_state (user_id, quiet_until) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET quiet_until = excluded.quiet_until')
      .run(req.user.sub, until)
    return stateOf(req.user.sub)
  })

  app.delete('/v0/account/quiet-mode', manage, async (req) => {
    db.prepare('UPDATE account_state SET quiet_until = NULL WHERE user_id = ?').run(req.user.sub)
    return stateOf(req.user.sub)
  })

  app.post('/v0/account/deactivate', manage, async (req) => {
    db.prepare('INSERT INTO account_state (user_id, deactivated_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET deactivated_at = COALESCE(deactivated_at, excluded.deactivated_at)')
      .run(req.user.sub, Date.now())
    return stateOf(req.user.sub)
  })

  // While deletion is pending the account stays deactivated: the member must cancel the deletion first.
  app.delete('/v0/account/deactivate', manage, async (req, reply) => {
    db.prepare('UPDATE account_state SET deactivated_at = NULL WHERE user_id = ? AND delete_requested_at IS NULL').run(req.user.sub)
    const state = stateOf(req.user.sub)
    if (state.deleteRequestedAt !== null) return reply.code(409).send({ error: 'deletion_pending', ...state })
    return state
  })

  // Idempotent: a repeated request keeps the original start time and reason, so it cannot extend the grace period.
  app.post('/v0/account/delete-request', manage, async (req, reply) => {
    const body = deleteSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' })
    const now = Date.now()
    db.prepare(`
      INSERT INTO account_state (user_id, deactivated_at, delete_requested_at, delete_reason) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        deactivated_at = COALESCE(deactivated_at, excluded.deactivated_at),
        delete_reason = CASE WHEN delete_requested_at IS NULL THEN excluded.delete_reason ELSE delete_reason END,
        delete_requested_at = COALESCE(delete_requested_at, excluded.delete_requested_at)
    `).run(req.user.sub, now, now, body.data?.reason || null)
    return stateOf(req.user.sub)
  })

  // Reactivates only if the deactivation came from the request: that deactivation shares the request's
  // timestamp, whereas an earlier, separate deactivation has an older one and is left in place.
  app.delete('/v0/account/delete-request', manage, async (req) => {
    db.prepare(`
      UPDATE account_state SET
        deactivated_at = CASE WHEN deactivated_at = delete_requested_at THEN NULL ELSE deactivated_at END,
        delete_requested_at = NULL, delete_reason = NULL
      WHERE user_id = ? AND delete_requested_at IS NOT NULL
    `).run(req.user.sub)
    return stateOf(req.user.sub)
  })
}
