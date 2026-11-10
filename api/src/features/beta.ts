import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { audit, db } from '../db.ts'
import { authed, getUser, requireAdmin } from '../guards.ts'
import { getSettings } from '../plans.ts'

// Closed-beta tooling: invite codes, gender caps, free beta credits, price-interest survey, admin metrics.

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const genCode = (len = 8) => Array.from(randomBytes(len), (b) => ALPHABET[b % ALPHABET.length]).join('')
export const normCode = (c: string) => c.trim().toUpperCase()

/** True if the beta cap for this gender is reached. 0 means no cap. */
export function betaFull(gender: 'man' | 'woman'): boolean {
  const s = getSettings()
  const cap = gender === 'woman' ? s.cap_women : s.cap_men
  if (cap <= 0) return false
  const n = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE gender = ? AND status != 'deleted' AND role != 'admin'").get(gender) as { n: number }).n
  return n >= cap
}

/** Grants the free beta credits to a man once. Call inside the transaction that sets his gender. */
export function grantBetaCredits(userId: string) {
  const s = getSettings()
  if (!s.beta_free || s.beta_free_requests <= 0) return
  const r = db.prepare("UPDATE users SET request_credits = request_credits + ?, beta_credits_granted = 1 WHERE id = ? AND gender = 'man' AND beta_credits_granted = 0")
    .run(s.beta_free_requests, userId)
  if (r.changes > 0) {
    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1").get() as { id: string } | undefined
    if (admin) audit(admin.id, 'beta.free_credits', userId, { credits: s.beta_free_requests, system: true })
  }
}

export type InviteUse = { ownerId: string | null; campaignId: string | null; label: string; kind: 'campaign' | 'member' | 'batch'; ref: string }

/** Consumes one use of a code. Returns who it came from on success, or 'invalid'. */
export function consumeInvite(raw: string | undefined): InviteUse | 'invalid' {
  const code = normCode(raw ?? '')
  if (!code) return 'invalid'
  const row = db.prepare('SELECT created_by, campaign_id, label FROM invite_codes WHERE code = ?').get(code) as
    { created_by: string | null; campaign_id: string | null; label: string } | undefined
  if (!row) return 'invalid'
  const r = db.prepare('UPDATE invite_codes SET uses = uses + 1 WHERE code = ? AND uses < max_uses').run(code)
  if (r.changes === 0) return 'invalid'
  const kind = row.campaign_id ? 'campaign' : row.created_by ? 'member' : 'batch'
  const ref = row.campaign_id ?? row.created_by ?? (row.label || 'unlabeled')
  return { ownerId: row.created_by, campaignId: row.campaign_id, label: row.label, kind, ref }
}

/** Beta metrics; also the source of the launch tracker's automatic items. */
export function computeMetrics() {
    const n = (sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as { n: number }).n
    const members = (g: string, verifiedOnly: boolean) =>
      n(`SELECT COUNT(*) AS n FROM users WHERE gender = ? AND role != 'admin' AND ${verifiedOnly ? "status = 'active'" : "status != 'deleted'"}`, g)
    const returned = (g: string) => n(`
      SELECT COUNT(DISTINCT u.id) AS n FROM users u JOIN user_activity a ON a.user_id = u.id
      WHERE u.gender = ? AND u.status != 'deleted' AND u.role != 'admin'
        AND julianday(a.day) - julianday(date(u.created_at / 1000, 'unixepoch')) >= 7`, g)
    const reqCount = (status?: string) =>
      status ? n('SELECT COUNT(*) AS n FROM requests WHERE status = ?', status) : n('SELECT COUNT(*) AS n FROM requests')
    const sent = reqCount(), accepted = reqCount('accepted'), declined = reqCount('declined'), pending = reqCount('pending')
    const acceptanceRate = sent > 0 ? accepted / (accepted + declined + pending) : 0
    const pi = (a: string) => n("SELECT COUNT(*) AS n FROM users WHERE price_interest = ? AND role != 'admin' AND gender = 'man'", a)
    const friendsBrought = n('SELECT COUNT(*) AS n FROM users WHERE invited_by IS NOT NULL')
    const verifiedWomen = members('woman', true)
    const s = getSettings()
    return {
      members: { women: members('woman', false), men: members('man', false), verifiedWomen, verifiedMen: members('man', true) },
      returnedWeek2: { women: returned('woman'), men: returned('man') },
      requests: { sent, accepted, declined, pending, acceptanceRate },
      friendsBrought,
      priceInterest: { yes: pi('yes'), no: pi('no'), maybe: pi('maybe') },
      caps: { women: s.cap_women, men: s.cap_men },
      gates: {
        women20: verifiedWomen >= 20,
        women30: verifiedWomen >= 30,
        acceptance20: sent >= 300 && acceptanceRate >= 0.2,
        acceptance30: sent >= 300 && acceptanceRate >= 0.3,
        friends10: friendsBrought >= 10,
      },
    }
}

export async function betaRoutes(app: FastifyInstance) {
  const admin = { ...authed, preHandler: [requireAdmin] }

  app.get('/v0/public-config', async () => {
    const s = getSettings()
    return {
      inviteOnly: s.invite_only, betaFree: s.beta_free, betaCity: s.beta_city,
      // How members reach us for help (empty until the owner sets them).
      supportEmail: s.support_email, supportWhatsapp: s.support_whatsapp,
    }
  })

  app.get('/v0/me/invite', authed, async (req, reply) => {
    const u = getUser(req.user.sub)
    if (!u) return reply.code(401).send({ error: 'unauthorized' })
    let row = db.prepare('SELECT code FROM invite_codes WHERE created_by = ? ORDER BY created_at LIMIT 1').get(u.id) as { code: string } | undefined
    if (!row) {
      for (let i = 0; i < 5 && !row; i++) {
        const code = genCode()
        const r = db.prepare('INSERT OR IGNORE INTO invite_codes (code,label,max_uses,uses,created_by,created_at) VALUES (?,?,?,0,?,?)')
          .run(code, 'member', 1_000_000, u.id, Date.now())
        if (r.changes > 0) row = { code }
      }
      if (!row) return reply.code(500).send({ error: 'server_error' })
    }
    const n = (db.prepare('SELECT COUNT(*) AS n FROM users WHERE invited_by = ?').get(u.id) as { n: number }).n
    return { code: row.code, friendsBrought: n }
  })

  app.post('/v0/me/price-interest', authed, async (req, reply) => {
    const body = z.object({ answer: z.enum(['yes', 'no', 'maybe']) }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' })
    const me = getUser(req.user.sub)
    if (!me) return reply.code(401).send({ error: 'unauthorized' })
    // The question is about what a man would pay for requests; a woman's answer would only distort the numbers.
    if (me.gender !== 'man') return reply.code(403).send({ error: 'not_applicable' })
    db.prepare('UPDATE users SET price_interest = ? WHERE id = ?').run(body.data.answer, req.user.sub)
    return { priceInterest: body.data.answer }
  })

  app.post('/v0/admin/invites', admin, async (req, reply) => {
    const body = z.object({
      count: z.number().int().min(1).max(200),
      label: z.string().trim().max(60).default(''),
      maxUses: z.number().int().min(1).max(1_000_000).default(1),
    }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' })
    const codes: string[] = []
    const ins = db.prepare('INSERT OR IGNORE INTO invite_codes (code,label,max_uses,uses,created_by,created_at) VALUES (?,?,?,0,NULL,?)')
    while (codes.length < body.data.count) {
      const code = genCode()
      if (ins.run(code, body.data.label, body.data.maxUses, Date.now()).changes > 0) codes.push(code)
    }
    audit(req.user.sub, 'invites.create', null, { count: codes.length, label: body.data.label, maxUses: body.data.maxUses })
    return { codes }
  })

  app.get('/v0/admin/invites', admin, async () => {
    const rows = db.prepare(`
      SELECT c.code AS code, c.label AS label, c.max_uses AS max_uses, c.uses AS uses, c.created_at AS created_at, u.name AS owner_name,
             c.campaign_id AS campaign_id
      FROM invite_codes c LEFT JOIN users u ON u.id = c.created_by
      ORDER BY c.created_at DESC, c.rowid DESC LIMIT 1000`).all() as any[]
    return {
      codes: rows.map((r) => ({
        code: r.code as string, label: r.label as string, maxUses: r.max_uses as number, uses: r.uses as number,
        createdAt: r.created_at as number, owner: (r.owner_name as string | null) ?? null,
        campaign: r.campaign_id != null,
      })),
    }
  })

  // Delete one code. Members who already joined with it keep their account and their "invited by" link;
  // the code just stops working. A campaign's code is removed by deleting the campaign, not here.
  app.delete('/v0/admin/invites/:code', admin, async (req, reply) => {
    const code = String((req.params as { code: string }).code ?? '').trim().toUpperCase()
    if (!/^[0-9A-Z]{1,32}$/.test(code)) return reply.code(400).send({ error: 'invalid_input' })
    const row = db.prepare('SELECT code, label, uses, campaign_id, created_by FROM invite_codes WHERE code = ?').get(code) as
      { code: string; label: string; uses: number; campaign_id: string | null; created_by: string | null } | undefined
    if (!row) return reply.code(404).send({ error: 'not_found' })
    if (row.campaign_id) return reply.code(409).send({ error: 'campaign_code' })
    db.prepare('DELETE FROM invite_codes WHERE code = ?').run(code)
    audit(req.user.sub, 'invites.delete', null, { code, label: row.label, uses: row.uses, memberCode: row.created_by != null })
    return { ok: true }
  })

  // Clear out admin-made codes nobody has used (member codes and campaign codes are never touched).
  app.post('/v0/admin/invites/delete-unused', admin, async (req) => {
    const r = db.prepare('DELETE FROM invite_codes WHERE uses = 0 AND created_by IS NULL AND campaign_id IS NULL').run()
    audit(req.user.sub, 'invites.delete_unused', null, { deleted: Number(r.changes) })
    return { deleted: Number(r.changes) }
  })

  app.get('/v0/admin/metrics', admin, async () => computeMetrics())
}
