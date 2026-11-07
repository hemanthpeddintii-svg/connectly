import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, newId, publicProfile, type UserRow } from './db.ts'
import { authed, getUser, requireActive } from './guards.ts'
import { actionGuards, composeFilters, connectionFilters, errorStatus, notifyRequest, pushToUser } from './features/hooks.ts'
import { tx } from './verification.ts'

// A request is one introduction: a man writes a short note to a woman; she accepts (which opens a chat) or says not now.
// One request per pair, ever: a "not now" is respected and can't be re-sent.
db.exec(`
  CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    from_id TEXT NOT NULL REFERENCES users(id),
    to_id TEXT NOT NULL REFERENCES users(id),
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
    connection_id TEXT REFERENCES connections(id),
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    UNIQUE (from_id, to_id)
  );
  CREATE INDEX IF NOT EXISTS idx_requests_to ON requests(to_id, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_requests_from ON requests(from_id, created_at);
`)

const NOTE_MAX = 300
const statuses = ['pending', 'accepted', 'declined'] as const

type RequestRow = { id: string; from_id: string; to_id: string; note: string; status: string; connection_id: string | null }

export async function requestRoutes(app: FastifyInstance) {
  const member = { ...authed, preHandler: [requireActive] }

  // ---- men: send ---------------------------------------------------------
  app.post('/v0/requests', member, async (req, reply) => {
    const me = getUser(req.user.sub)!
    if (me.gender !== 'man') return reply.code(403).send({ error: 'not_applicable' })
    const body = z.object({ bumpId: z.string().min(1).max(32), note: z.string().trim().max(NOTE_MAX).default('') }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' })

    const target = db.prepare('SELECT * FROM users WHERE bump_id = ?').get(body.data.bumpId) as UserRow | undefined
    if (!target || target.id === me.id || target.status !== 'active' || target.gender !== 'woman') return reply.code(404).send({ error: 'not_found' })
    for (const guard of actionGuards) {
      const refused = guard(me.id, target)
      if (refused) return reply.code(errorStatus(refused)).send({ error: refused })
    }

    // The duplicate check, the credit and the insert are one transaction: a credit is only spent on a request that exists.
    const result = tx(() => {
      if (db.prepare('SELECT 1 FROM requests WHERE from_id = ? AND to_id = ?').get(me.id, target.id)) return 'already_requested' as const
      const spent = db.prepare('UPDATE users SET request_credits = request_credits - 1 WHERE id = ? AND request_credits > 0').run(me.id)
      if (spent.changes === 0) return 'no_requests_left' as const
      const id = newId()
      db.prepare('INSERT INTO requests (id, from_id, to_id, note, created_at) VALUES (?,?,?,?,?)').run(id, me.id, target.id, body.data.note, Date.now())
      return id
    })
    if (result === 'already_requested') return reply.code(409).send({ error: result })
    if (result === 'no_requests_left') return reply.code(402).send({ error: result })

    pushToUser(target.id, { type: 'request', requestId: result })
    notifyRequest({ kind: 'sent', requestId: result, recipientId: target.id, actorId: me.id })
    return reply.code(201).send({ id: result, creditsLeft: getUser(me.id)!.request_credits })
  })

  app.get('/v0/requests/sent', member, async (req, reply) => {
    if (getUser(req.user.sub)?.gender !== 'man') return reply.code(403).send({ error: 'not_applicable' })
    // Columns are aliased: u.* also has id, status and created_at, which would overwrite the request's own.
    const rows = db.prepare(`
      SELECT r.id AS request_id, r.status AS request_status, r.note AS request_note, r.created_at AS request_created_at,
             r.connection_id AS request_connection_id, u.*
      FROM requests r JOIN users u ON u.id = r.to_id
      WHERE r.from_id = ? ORDER BY r.created_at DESC LIMIT 100`).all(req.user.sub) as any[]
    return rows.map((r) => ({
      id: r.request_id as string,
      status: r.request_status as string,
      note: r.request_note as string,
      createdAt: r.request_created_at as number,
      to: { bumpId: r.bump_id as string, name: r.name as string, age: r.age as number },
      connectionId: (r.request_connection_id as string | null) ?? null,
    }))
  })

  // ---- women: inbox and decision -----------------------------------------
  app.get('/v0/requests/received', member, async (req, reply) => {
    if (getUser(req.user.sub)?.gender !== 'woman') return reply.code(403).send({ error: 'not_applicable' })
    const q = z.object({ status: z.enum(statuses).default('pending') }).safeParse(req.query)
    if (!q.success) return reply.code(400).send({ error: 'invalid_input' })
    // Same visibility rules as the chats list: blocked or deactivated members don't appear.
    const extra = composeFilters(connectionFilters, req.user.sub)
    const rows = db.prepare(`
      SELECT r.id AS request_id, r.status AS request_status, r.note AS request_note, r.created_at AS request_created_at, u.*
      FROM requests r JOIN users u ON u.id = r.from_id
      WHERE r.to_id = ? AND r.status = ?${extra.sql} ORDER BY r.created_at DESC LIMIT 100`).all(req.user.sub, q.data.status, ...extra.params) as any[]
    return rows.map((r) => ({
      id: r.request_id as string,
      status: r.request_status as string,
      note: r.request_note as string,
      createdAt: r.request_created_at as number,
      from: publicProfile(r),
    }))
  })

  app.post('/v0/requests/:id/decision', member, async (req, reply) => {
    const me = getUser(req.user.sub)!
    if (me.gender !== 'woman') return reply.code(403).send({ error: 'not_applicable' })
    const id = z.string().uuid().safeParse((req.params as { id: string }).id)
    const body = z.object({ decision: z.enum(['accept', 'decline']) }).safeParse(req.body)
    if (!id.success || !body.success) return reply.code(400).send({ error: 'invalid_input' })

    const r = db.prepare('SELECT * FROM requests WHERE id = ? AND to_id = ?').get(id.data, me.id) as RequestRow | undefined
    if (!r) return reply.code(404).send({ error: 'not_found' })
    const accept = body.data.decision === 'accept'

    if (accept) {
      // A block, suspension or deactivation that happened after the request was sent still applies.
      const sender = getUser(r.from_id)
      if (!sender || sender.status !== 'active') return reply.code(404).send({ error: 'not_found' })
      for (const guard of actionGuards) {
        const refused = guard(me.id, sender)
        if (refused) return reply.code(errorStatus(refused)).send({ error: refused })
      }
    }

    const outcome = tx(() => {
      const res = db.prepare("UPDATE requests SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'")
        .run(accept ? 'accepted' : 'declined', Date.now(), r.id)
      if (res.changes === 0) return null // someone (or a double tap) already decided it
      if (!accept) return { status: 'declined' as const }
      const [a, b] = r.from_id < r.to_id ? [r.from_id, r.to_id] : [r.to_id, r.from_id]
      const existing = db.prepare('SELECT id FROM connections WHERE a_id = ? AND b_id = ?').get(a, b) as { id: string } | undefined
      const connectionId = existing?.id ?? newId()
      if (!existing) db.prepare('INSERT INTO connections (id, a_id, b_id, created_at) VALUES (?,?,?,?)').run(connectionId, a, b, Date.now())
      db.prepare('UPDATE requests SET connection_id = ? WHERE id = ?').run(connectionId, r.id)
      return { status: 'accepted' as const, connectionId }
    })
    if (!outcome) return reply.code(409).send({ error: 'already_decided' })

    pushToUser(r.from_id, {
      type: 'request_update', requestId: r.id, status: outcome.status,
      ...('connectionId' in outcome ? { connectionId: outcome.connectionId } : {}),
    })
    if (outcome.status === 'accepted') notifyRequest({ kind: 'accepted', requestId: r.id, recipientId: r.from_id, actorId: me.id })
    return outcome
  })
}
