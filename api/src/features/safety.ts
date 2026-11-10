import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { audit, db, newId, track, type UserRow } from '../db.ts'
import { authed, requireActive, requireAdmin } from '../guards.ts'
import { tx } from '../verification.ts'
import { actionGuards, connectionFilters, messageGuards, wallFilters } from './hooks.ts'

db.exec(`
  CREATE TABLE IF NOT EXISTS blocks (
    blocker_id TEXT NOT NULL REFERENCES users(id),
    blocked_id TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id)
  );
  CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_id);
  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    reporter_id TEXT NOT NULL REFERENCES users(id),
    reported_id TEXT NOT NULL REFERENCES users(id),
    reason TEXT NOT NULL CHECK (reason IN ('fake_profile','harassment','inappropriate_content','spam','underage','other')),
    details TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','actioned','dismissed')),
    note TEXT,
    reviewed_by TEXT REFERENCES users(id),
    created_at INTEGER NOT NULL,
    reviewed_at INTEGER
  );
  -- At most one open report per reporter and reported member, enforced by the database.
  CREATE UNIQUE INDEX IF NOT EXISTS one_open_report_per_pair ON reports(reporter_id, reported_id) WHERE status = 'open';
  CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id, created_at);
  CREATE TABLE IF NOT EXISTS suspensions (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    reason TEXT,
    created_by TEXT REFERENCES users(id),
    created_at INTEGER NOT NULL
  );
`)

// Evidence: a snapshot of the conversation, saved when the report is filed so it survives later deletions.
{
  const cols = (db.prepare('PRAGMA table_info(reports)').all() as { name: string }[]).map((c) => c.name)
  if (!cols.includes('evidence')) db.exec('ALTER TABLE reports ADD COLUMN evidence TEXT')
}

const REPORTS_PER_DAY = 10
const DAY_MS = 24 * 60 * 60 * 1000
const EVIDENCE_MESSAGES = 30

type Evidence = {
  capturedAt: number
  request: { note: string; from: 'reporter' | 'reported'; status: string; at: number } | null
  messages: Array<{ from: 'reporter' | 'reported'; kind: string; body: string; durationMs: number | null; at: number }>
  truncated: boolean
}

/** The request note and the last messages between the two members, as they were when the report was filed. */
function buildEvidence(reporterId: string, reportedId: string): Evidence {
  const who = (id: string): 'reporter' | 'reported' => (id === reporterId ? 'reporter' : 'reported')
  const rq = db.prepare(`
    SELECT from_id, note, status, created_at FROM requests
    WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)
    ORDER BY created_at DESC LIMIT 1`).get(reporterId, reportedId, reportedId, reporterId) as
    { from_id: string; note: string; status: string; created_at: number } | undefined
  const conn = db.prepare('SELECT id FROM connections WHERE (a_id = ? AND b_id = ?) OR (a_id = ? AND b_id = ?)')
    .get(reporterId, reportedId, reportedId, reporterId) as { id: string } | undefined
  let messages: Evidence['messages'] = []
  let truncated = false
  if (conn) {
    const rows = db.prepare(`
      SELECT sender_id, kind, body, attachment_duration_ms, created_at FROM messages
      WHERE connection_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(conn.id, EVIDENCE_MESSAGES + 1) as
      { sender_id: string; kind: string; body: string; attachment_duration_ms: number | null; created_at: number }[]
    truncated = rows.length > EVIDENCE_MESSAGES
    messages = rows.slice(0, EVIDENCE_MESSAGES).reverse().map((m) => ({
      from: who(m.sender_id), kind: m.kind, body: m.kind === 'text' ? m.body : '', durationMs: m.attachment_duration_ms, at: m.created_at,
    }))
  }
  return {
    capturedAt: Date.now(),
    request: rq ? { note: rq.note, from: who(rq.from_id), status: rq.status, at: rq.created_at } : null,
    messages, truncated,
  }
}

const blockedEitherWay = (x: string, y: string) =>
  !!db.prepare(
    'SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
  ).get(x, y, y, x)

const isSuspended = (userId: string) => !!db.prepare('SELECT 1 FROM suspensions WHERE user_id = ?').get(userId)

const noBlockBetween = (viewerId: string) => ({
  sql: `NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?))`,
  params: [viewerId, viewerId],
})

wallFilters.push(
  noBlockBetween,
  () => ({ sql: 'NOT EXISTS (SELECT 1 FROM suspensions s WHERE s.user_id = u.id)', params: [] }),
)
connectionFilters.push(noBlockBetween)

// 'not_found' rather than a distinct code so a refusal never reveals that a block exists.
actionGuards.push((fromId, target) => {
  if (isSuspended(fromId)) return 'suspended'
  if (isSuspended(target.id) || blockedEitherWay(fromId, target.id)) return 'not_found'
  return null
})

messageGuards.push((sender: UserRow, otherId) => {
  if (isSuspended(sender.id)) return 'suspended'
  return blockedEitherWay(sender.id, otherId) ? 'blocked' : null
})

const findActiveByMemberId = (memberId: string) =>
  db.prepare("SELECT * FROM users WHERE member_id = ? AND status = 'active'").get(memberId) as UserRow | undefined

const reasonSchema = z.enum(['fake_profile', 'harassment', 'inappropriate_content', 'spam', 'underage', 'other'])

type AdminReportRow = {
  id: string; reason: string; details: string | null; status: string; note: string | null
  created_at: number; reviewed_at: number | null
  reporter_member_id: string; reporter_name: string
  reported_member_id: string; reported_name: string; reported_age: number; reported_email: string
  suspended: number; open_count: number
}

export async function safetyRoutes(app: FastifyInstance) {
  const member = { ...authed, preHandler: [requireActive] }
  const admin = { ...authed, preHandler: [requireAdmin] }

  app.post('/v0/blocks', member, async (req, reply) => {
    const body = z.object({ memberId: z.string().min(1).max(32) }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' })
    const target = findActiveByMemberId(body.data.memberId)
    if (!target) return reply.code(404).send({ error: 'not_found' })
    if (target.id === req.user.sub) return reply.code(400).send({ error: 'cannot_target_self' })
    db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?,?,?)')
      .run(req.user.sub, target.id, Date.now())
    track('block_made', req.user.sub)
    return { ok: true }
  })

  app.delete('/v0/blocks/:memberId', member, async (req, reply) => {
    const p = z.object({ memberId: z.string().min(1).max(32) }).safeParse(req.params)
    if (!p.success) return reply.code(400).send({ error: 'invalid_input' })
    db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = (SELECT id FROM users WHERE member_id = ?)')
      .run(req.user.sub, p.data.memberId)
    return { ok: true }
  })

  app.get('/v0/blocks', member, async (req) => {
    const rows = db.prepare(`
      SELECT u.member_id, u.name, u.age FROM blocks b JOIN users u ON u.id = b.blocked_id
      WHERE b.blocker_id = ? ORDER BY b.created_at DESC, u.member_id`).all(req.user.sub) as { member_id: string; name: string; age: number }[]
    return rows.map((r) => ({ memberId: r.member_id, name: r.name, age: r.age }))
  })

  app.post('/v0/reports', member, async (req, reply) => {
    const body = z.object({
      memberId: z.string().min(1).max(32),
      reason: reasonSchema,
      details: z.string().trim().max(500).default(''),
    }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' })
    const target = findActiveByMemberId(body.data.memberId)
    if (!target) return reply.code(404).send({ error: 'not_found' })
    if (target.id === req.user.sub) return reply.code(400).send({ error: 'cannot_target_self' })

    const reporter = req.user.sub
    const outcome = tx(() => {
      if (db.prepare("SELECT 1 FROM reports WHERE reporter_id = ? AND reported_id = ? AND status = 'open'").get(reporter, target.id)) {
        return 'already_reported' as const
      }
      const recent = db.prepare('SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND created_at > ?')
        .get(reporter, Date.now() - DAY_MS) as { n: number }
      if (recent.n >= REPORTS_PER_DAY) return 'rate_limited' as const
      db.prepare('INSERT INTO reports (id, reporter_id, reported_id, reason, details, created_at, evidence) VALUES (?,?,?,?,?,?,?)')
        .run(newId(), reporter, target.id, body.data.reason, body.data.details || null, Date.now(), JSON.stringify(buildEvidence(reporter, target.id)))
      return 'ok' as const
    })
    if (outcome === 'already_reported') return reply.code(409).send({ error: 'already_reported' })
    if (outcome === 'rate_limited') return reply.code(429).send({ error: 'rate_limited' })
    track('report_filed', reporter, { reason: body.data.reason })
    return reply.code(201).send({ ok: true })
  })

  app.get('/v0/admin/reports', admin, async (req, reply) => {
    const q = z.object({ status: z.enum(['open', 'actioned', 'dismissed']).default('open') }).safeParse(req.query)
    if (!q.success) return reply.code(400).send({ error: 'invalid_input' })
    const rows = db.prepare(`
      SELECT r.id, r.reason, r.details, r.status, r.note, r.created_at, r.reviewed_at,
        rep.member_id AS reporter_member_id, rep.name AS reporter_name,
        tgt.member_id AS reported_member_id, tgt.name AS reported_name, tgt.age AS reported_age, tgt.email AS reported_email,
        EXISTS (SELECT 1 FROM suspensions s WHERE s.user_id = tgt.id) AS suspended,
        (SELECT COUNT(*) FROM reports o WHERE o.reported_id = tgt.id AND o.status = 'open') AS open_count
      FROM reports r
      JOIN users rep ON rep.id = r.reporter_id
      JOIN users tgt ON tgt.id = r.reported_id
      WHERE r.status = ?
      ORDER BY CASE WHEN r.status = 'open' THEN r.created_at END ASC, r.created_at DESC
      LIMIT 200`).all(q.data.status) as AdminReportRow[]
    return rows.map((r) => ({
      report: {
        id: r.id, reason: r.reason, details: r.details, status: r.status, note: r.note,
        createdAt: r.created_at, reviewedAt: r.reviewed_at,
      },
      reporter: { memberId: r.reporter_member_id, name: r.reporter_name },
      reported: {
        memberId: r.reported_member_id, name: r.reported_name, age: r.reported_age, email: r.reported_email,
        suspended: r.suspended === 1, openReportCount: r.open_count,
      },
    }))
  })

  // The saved conversation for one report. Opening it is written to the audit log.
  app.get('/v0/admin/reports/:id/evidence', admin, async (req, reply) => {
    const id = z.string().uuid().safeParse((req.params as any).id)
    if (!id.success) return reply.code(400).send({ error: 'invalid_input' })
    const row = db.prepare('SELECT reported_id, evidence FROM reports WHERE id = ?').get(id.data) as { reported_id: string; evidence: string | null } | undefined
    if (!row) return reply.code(404).send({ error: 'not_found' })
    audit(req.user.sub, 'report.evidence_viewed', row.reported_id, { reportId: id.data })
    if (!row.evidence) return { available: false as const }
    try { return { available: true as const, ...(JSON.parse(row.evidence) as Evidence) } } catch { return { available: false as const } }
  })

  app.post('/v0/admin/reports/:id/decision', admin, async (req, reply) => {
    const id = z.string().uuid().safeParse((req.params as any).id)
    const body = z.discriminatedUnion('decision', [
      z.object({ decision: z.literal('dismiss'), note: z.string().trim().max(500).optional() }),
      z.object({ decision: z.literal('action'), note: z.string().trim().min(1).max(500), suspend: z.boolean() }),
    ]).safeParse(req.body)
    if (!id.success || !body.success) return reply.code(400).send({ error: 'invalid_input' })

    const reviewer = req.user.sub
    const d = body.data
    const outcome = tx(() => {
      const r = db.prepare('SELECT reported_id FROM reports WHERE id = ?').get(id.data) as { reported_id: string } | undefined
      if (!r) return 'not_found' as const
      // Guarded on status='open' so two admins can't both decide the same report.
      const res = db.prepare("UPDATE reports SET status=?, note=?, reviewed_by=?, reviewed_at=? WHERE id=? AND status='open'")
        .run(d.decision === 'action' ? 'actioned' : 'dismissed', d.note || null, reviewer, Date.now(), id.data)
      if (res.changes === 0) return 'already_decided' as const
      const suspend = d.decision === 'action' && d.suspend
      if (suspend) {
        db.prepare('INSERT OR IGNORE INTO suspensions (user_id, reason, created_by, created_at) VALUES (?,?,?,?)')
          .run(r.reported_id, d.note, reviewer, Date.now())
      }
      audit(reviewer, d.decision === 'action' ? 'report.actioned' : 'report.dismissed', r.reported_id, { reportId: id.data, note: d.note ?? null, suspended: suspend })
      return 'ok' as const
    })
    if (outcome === 'not_found') return reply.code(404).send({ error: 'not_found' })
    if (outcome === 'already_decided') return reply.code(409).send({ error: 'already_decided' })
    track('report_decided', reviewer, { decision: d.decision, suspended: d.decision === 'action' && d.suspend })
    return { ok: true }
  })

  app.post('/v0/admin/suspensions/:memberId/lift', admin, async (req, reply) => {
    const p = z.object({ memberId: z.string().min(1).max(32) }).safeParse(req.params)
    if (!p.success) return reply.code(400).send({ error: 'invalid_input' })
    const target = db.prepare('SELECT id FROM users WHERE member_id = ?').get(p.data.memberId) as { id: string } | undefined
    const lifted = tx(() => {
      if (!target) return false
      if (db.prepare('DELETE FROM suspensions WHERE user_id = ?').run(target.id).changes === 0) return false
      audit(req.user.sub, 'suspension.lifted', target.id)
      return true
    })
    if (!lifted) return reply.code(404).send({ error: 'not_found' })
    track('suspension_lifted', target!.id)
    return { ok: true }
  })
}
