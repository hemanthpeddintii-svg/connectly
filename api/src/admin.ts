import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { audit, db } from './db.ts'
import { authed, requireAdmin } from './guards.ts'
import { getSettings, writeSetting } from './plans.ts'
import { tx } from './verification.ts'

const memberParam = z.string().regex(/^[0-9A-Za-z]{1,16}$/)
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

// Aliased columns throughout: users.* next to other tables' id/created_at once returned the wrong ids.
const MEMBER_COLS = `u.member_id AS member_id, u.name AS name, u.age AS age, u.email AS email, u.gender AS gender, u.role AS role,
  u.status AS status, u.request_credits AS request_credits, u.created_at AS joined_at, u.city AS city, u.looking_for AS looking_for,
  u.rejection_reason AS rejection_reason, EXISTS (SELECT 1 FROM suspensions s WHERE s.user_id = u.id) AS suspended`

const member = (r: any) => ({
  memberId: r.member_id as string, name: r.name as string, age: r.age as number, email: r.email as string,
  gender: r.gender as string | null, role: r.role as string, status: r.status as string,
  requestCredits: r.request_credits as number, joinedAt: r.joined_at as number, suspended: !!r.suspended,
})

const reasonList = z.array(z.string().trim().min(1).max(80)).max(8)
const settingsSchema = z.object({
  packs: z.array(z.object({
    id: z.enum(['pack10', 'pack20']),
    requests: z.number().int().min(1).max(500),
    amountPaise: z.number().int().min(100).max(10_000_000),
  })).length(2).refine((p) => new Set(p.map((x) => x.id)).size === 2, 'duplicate pack'),
  payee: z.object({
    name: z.string().trim().max(100).nullable().transform((v) => v || null),
    upiId: z.string().trim().max(100).nullable().transform((v) => v || null),
  }),
  quickReasons: z.object({ verification: reasonList, payment: reasonList }),
  invite_only: z.boolean().optional(),
  beta_free: z.boolean().optional(),
  beta_free_requests: z.number().int().min(0).max(500).optional(),
  cap_women: z.number().int().min(0).max(1_000_000).optional(),
  cap_men: z.number().int().min(0).max(1_000_000).optional(),
  beta_city: z.string().trim().max(60).optional(),
  pay_cap_men: z.number().int().min(0).max(1_000_000).optional(),
  pay_cap_rupees: z.number().int().min(0).max(100_000_000).optional(),
  // Contact details are shown publicly, so they are checked: an email address, and a phone number of 8 to 15 digits.
  support_email: z.string().trim().max(100).refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'bad email').optional(),
  support_whatsapp: z.string().trim().max(25).refine((v) => v === '' || /^\+?[0-9 ()-]{8,25}$/.test(v) && v.replace(/\D/g, '').length >= 8 && v.replace(/\D/g, '').length <= 15, 'bad number').optional(),
})
// The web app may send either snake_case or camelCase beta keys.
const betaAliases: Record<string, string> = {
  inviteOnly: 'invite_only', betaFree: 'beta_free', betaFreeRequests: 'beta_free_requests',
  capWomen: 'cap_women', capMen: 'cap_men', betaCity: 'beta_city',
  payCapMen: 'pay_cap_men', payCapRupees: 'pay_cap_rupees', supportEmail: 'support_email', supportWhatsapp: 'support_whatsapp',
}
const normalizeSettingsBody = (b: unknown) => {
  if (!b || typeof b !== 'object') return b
  const out: Record<string, unknown> = { ...(b as Record<string, unknown>) }
  for (const [camel, snake] of Object.entries(betaAliases)) {
    // The camelCase key is the one the admin page sets on purpose (it also echoes the old snake_case values back), so it wins.
    if (camel in out) { out[snake] = out[camel]; delete out[camel] }
  }
  return out
}
const withCamel = (s: ReturnType<typeof getSettings>) => ({
  ...s,
  inviteOnly: s.invite_only, betaFree: s.beta_free, betaFreeRequests: s.beta_free_requests,
  capWomen: s.cap_women, capMen: s.cap_men, betaCity: s.beta_city,
  payCapMen: s.pay_cap_men, payCapRupees: s.pay_cap_rupees, supportEmail: s.support_email, supportWhatsapp: s.support_whatsapp,
})

export async function adminRoutes(app: FastifyInstance) {
  const admin = { ...authed, preHandler: [requireAdmin] }

  app.get('/v0/admin/overview', admin, async () => {
    const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n
    const oldest = (table: string, where: string) =>
      (db.prepare(`SELECT MIN(created_at) AS t FROM ${table} WHERE ${where}`).get() as { t: number | null }).t
    const recent = db.prepare(`
      SELECT kind, member_id, name, decision, admin_name, at FROM (
        SELECT 'verification' AS kind, t.member_id AS member_id, t.name AS name, v.status AS decision, a.name AS admin_name, v.reviewed_at AS at
          FROM verifications v JOIN users t ON t.id = v.user_id LEFT JOIN users a ON a.id = v.reviewed_by WHERE v.status != 'pending'
        UNION ALL
        SELECT 'payment', t.member_id, t.name, p.status, a.name, p.reviewed_at
          FROM payments p JOIN users t ON t.id = p.user_id LEFT JOIN users a ON a.id = p.reviewed_by WHERE p.status != 'pending'
        UNION ALL
        SELECT 'report', t.member_id, t.name, r.status, a.name, r.reviewed_at
          FROM reports r JOIN users t ON t.id = r.reported_id LEFT JOIN users a ON a.id = r.reviewed_by WHERE r.status != 'open'
      ) WHERE at IS NOT NULL ORDER BY at DESC LIMIT 8`).all() as any[]
    return {
      verificationsPending: count("SELECT COUNT(*) AS n FROM verifications WHERE status = 'pending'"),
      paymentsPending: count("SELECT COUNT(*) AS n FROM payments WHERE status = 'pending'"),
      reportsOpen: count("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
      oldestWaiting: {
        verification: oldest('verifications', "status = 'pending'"),
        payment: oldest('payments', "status = 'pending'"),
        report: oldest('reports', "status = 'open'"),
      },
      recent: recent.map((r) => ({
        kind: r.kind as 'verification' | 'payment' | 'report',
        member: { memberId: r.member_id as string, name: r.name as string },
        decision: r.decision as string, by: (r.admin_name as string | null) ?? '', at: r.at as number,
      })),
    }
  })

  app.get('/v0/admin/members', admin, async (req, reply) => {
    const q = z.object({
      q: z.string().trim().max(100).optional(),
      status: z.enum(['unverified', 'pending', 'active', 'rejected', 'deleted']).optional(),
      role: z.enum(['user', 'admin']).optional(),
      gender: z.enum(['man', 'woman']).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
    }).safeParse(req.query)
    if (!q.success) return reply.code(400).send({ error: 'invalid_input' })
    const where: string[] = []
    const params: (string | number)[] = []
    if (q.data.q) {
      const like = `%${likeEscape(q.data.q.toLowerCase())}%`
      where.push("(lower(u.name) LIKE ? ESCAPE '\\' OR lower(u.email) LIKE ? ESCAPE '\\' OR lower(u.member_id) LIKE ? ESCAPE '\\')")
      params.push(like, like, like)
    }
    for (const [col, v] of [['status', q.data.status], ['role', q.data.role], ['gender', q.data.gender]] as const) {
      if (v) { where.push(`u.${col} = ?`); params.push(v) }
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM users u ${w}`).get(...params) as { n: number }).n
    const rows = db.prepare(`SELECT ${MEMBER_COLS} FROM users u ${w} ORDER BY u.created_at DESC, u.rowid DESC LIMIT ? OFFSET ?`)
      .all(...params, q.data.limit, q.data.offset)
    return { total, items: rows.map(member) }
  })

  app.get('/v0/admin/members/:memberId', admin, async (req, reply) => {
    const p = memberParam.safeParse((req.params as any).memberId)
    if (!p.success) return reply.code(400).send({ error: 'invalid_input' })
    const row = db.prepare(`SELECT u.id AS uid, ${MEMBER_COLS} FROM users u WHERE u.member_id = ?`).get(p.data) as any
    if (!row) return reply.code(404).send({ error: 'not_found' })
    const verifications = db.prepare(
      'SELECT id, status, reason, created_at, reviewed_at FROM verifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
    ).all(row.uid) as any[]
    const payments = db.prepare(
      'SELECT id, plan_id, credits, amount_paise, status, reason, reference, created_at FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
    ).all(row.uid) as any[]
    const auditRows = db.prepare(`
      SELECT au.id AS id, au.action AS action, au.detail AS detail, au.created_at AS at, a.name AS admin_name
      FROM admin_audit au LEFT JOIN users a ON a.id = au.admin_id
      WHERE au.target_user_id = ? ORDER BY au.created_at DESC, au.rowid DESC LIMIT 100`).all(row.uid) as any[]
    return {
      member: { ...member(row), city: row.city as string, lookingFor: row.looking_for as string, rejectionReason: row.rejection_reason as string | null },
      verifications: verifications.map((v) => ({ id: v.id, status: v.status, reason: v.reason, createdAt: v.created_at, reviewedAt: v.reviewed_at })),
      payments: payments.map((x) => ({
        id: x.id, planId: x.plan_id, requests: x.credits, amountPaise: x.amount_paise, status: x.status, reason: x.reason,
        reference: x.reference, createdAt: x.created_at,
      })),
      audit: auditRows.map((a) => {
        let detail: unknown = {}
        try { detail = JSON.parse(a.detail) } catch { /* keep empty */ }
        return { id: a.id, action: a.action, detail, by: (a.admin_name as string | null) ?? '', at: a.at }
      }),
    }
  })

  app.post('/v0/admin/members/:memberId/credits', admin, async (req, reply) => {
    const p = memberParam.safeParse((req.params as any).memberId)
    const body = z.object({
      delta: z.number().int().refine((n) => n !== 0 && Math.abs(n) <= 1000),
      reason: z.string().trim().min(1).max(200),
    }).safeParse(req.body)
    if (!p.success || !body.success) return reply.code(400).send({ error: 'invalid_input' })
    const out = tx(() => {
      const u = db.prepare('SELECT id, request_credits FROM users WHERE member_id = ?').get(p.data) as { id: string; request_credits: number } | undefined
      if (!u) return { error: 'not_found' as const }
      const next = u.request_credits + body.data.delta
      if (next < 0) return { error: 'would_go_negative' as const }
      db.prepare('UPDATE users SET request_credits = ? WHERE id = ?').run(next, u.id)
      audit(req.user.sub, 'credits.adjust', u.id, { delta: body.data.delta, reason: body.data.reason, from: u.request_credits, to: next })
      return { credits: next }
    })
    if ('error' in out) return reply.code(out.error === 'not_found' ? 404 : 409).send({ error: out.error })
    return { requestCredits: out.credits }
  })

  app.get('/v0/admin/settings', admin, async () => withCamel(getSettings()))

  app.put('/v0/admin/settings', admin, async (req, reply) => {
    const body = settingsSchema.safeParse(normalizeSettingsBody(req.body))
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' })
    const d = body.data
    tx(() => {
      writeSetting('packs', [...d.packs].sort((a, b) => a.id.localeCompare(b.id)).map((x) => ({ id: x.id, requests: x.requests, amountPaise: x.amountPaise })))
      writeSetting('payee', d.payee)
      writeSetting('quickReasons', d.quickReasons)
      const beta: Record<string, unknown> = {}
      for (const k of ['invite_only', 'beta_free', 'beta_free_requests', 'cap_women', 'cap_men', 'beta_city', 'pay_cap_men', 'pay_cap_rupees', 'support_email', 'support_whatsapp'] as const) {
        if (d[k] !== undefined) { writeSetting(k, d[k]); beta[k] = d[k] }
      }
      audit(req.user.sub, 'settings.update', null, { packs: d.packs, payeeChanged: true, ...beta })
    })
    return withCamel(getSettings())
  })
}
