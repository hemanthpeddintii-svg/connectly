import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { audit, db, newId, track, type UserRow } from '../db.ts'
import { authed, requireAdmin } from '../guards.ts'
import { writeSetting, getSettings, getPlans } from '../plans.ts'
import { rateLimit } from '../security.ts'
import { tx } from '../verification.ts'
import { salesState } from '../payments.ts'
import { computeMetrics, genCode, normCode } from './beta.ts'

// Admin analytics: campaigns and click counts, waitlist, launch tracker, users overview, health.
// Everything stays in our own SQLite. Event meta holds ids, kinds and counts only.

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const today = () => new Date().toISOString().slice(0, 10)
const num = (sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as { n: number }).n

/** The required profile fields are present. */
export const profileComplete = (u: Pick<UserRow, 'name' | 'age' | 'gender' | 'city' | 'bio'>) =>
  !!(u.name?.trim() && u.age && u.gender && u.city?.trim() && u.bio?.trim())

const median = (xs: number[]): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
const round2 = (n: number) => Math.round(n * 100) / 100

const readSetting = <T>(key: string): T | undefined => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  if (!row) return undefined
  try { return JSON.parse(row.value) as T } catch { return undefined }
}

// ---- campaigns -------------------------------------------------------------
type CampaignRow = {
  id: string; name: string; platform: string; topic: string; notes: string; cost_paise: number
  posted_at: string | null; code: string; created_at: string
}

function campaignJson(c: CampaignRow) {
  const clicks = num('SELECT COALESCE(SUM(count), 0) AS n FROM campaign_clicks WHERE campaign_id = ?', c.id)
  const q = (extra: string) => num(`SELECT COUNT(*) AS n FROM users WHERE source_kind = 'campaign' AND source_ref = ?${extra}`, c.id)
  const signups = q('')
  const verified = q(" AND status = 'active'")
  const women = q(" AND gender = 'woman'")
  const men = q(" AND gender = 'man'")
  return {
    id: c.id, name: c.name, platform: c.platform, topic: c.topic, notes: c.notes, costPaise: c.cost_paise,
    postedAt: c.posted_at, code: c.code, clicks, signups, verified, women, men,
    costPerVerifiedPaise: verified > 0 ? Math.round(c.cost_paise / verified) : null,
    createdAt: c.created_at,
  }
}

const campaignFields = {
  topic: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  costPaise: z.number().int().min(0).max(1_000_000_000).optional(),
  postedAt: z.string().trim().max(40).nullable().optional(),
}
const createCampaign = z.object({ name: z.string().trim().min(1).max(100), platform: z.string().trim().min(1).max(60), ...campaignFields })
const patchCampaign = z.object({ name: z.string().trim().min(1).max(100).optional(), platform: z.string().trim().min(1).max(60).optional(), ...campaignFields })
const normPostedAt = (v: string | null | undefined) => (v ? v : null)

// ---- launch tracker --------------------------------------------------------
const GROUPS = ['women', 'quality', 'legal', 'safety', 'ops'] as const
type Group = (typeof GROUPS)[number]
const MANUAL: { key: string; label: string; group: Group; detail: string }[] = [
  { key: 'counsel_review', label: 'Lawyer reviewed terms, privacy and consent flows', group: 'legal', detail: 'Confirm with counsel' },
  { key: 'name_cleared', label: 'Brand name cleared', group: 'legal', detail: 'No conflicting names or domains' },
  { key: 'trademark_search', label: 'Trademark search done', group: 'legal', detail: 'Search and filing plan recorded' },
  { key: 'legal_text_final', label: 'Final legal text published in the app', group: 'legal', detail: 'Terms, privacy, community rules' },
  { key: 'harassment_playbook', label: 'Harassment response playbook written', group: 'safety', detail: 'Who acts, how fast, what we say' },
  { key: 'deletion_drill', label: 'Account deletion drill completed', group: 'safety', detail: 'Request, grace period, purge verified' },
  { key: 'report_drill', label: 'Report handling drill completed', group: 'safety', detail: 'File, review, suspend, lift' },
  { key: 'block_report_tested', label: 'Block and report tested on real devices', group: 'safety', detail: 'End to end with two real accounts' },
  { key: 'real_phone_test', label: 'Tested on real phones', group: 'ops', detail: 'Android and iPhone, install and notifications' },
  { key: 'runway_3_months', label: 'Three months of runway', group: 'ops', detail: 'Costs covered without revenue' },
]

const AUTO_KEYS = ['women_20', 'women_30', 'week2_women_15', 'friends_10', 'acceptance_20', 'acceptance_30']
type MilestoneRow = { key: string; done: number; note: string | null; done_at: string | null; by: string | null }

function launchState() {
  const m = computeMetrics()
  const women = m.members.verifiedWomen
  const rate = m.requests.acceptanceRate
  const sent = m.requests.sent
  const pct = `${Math.round(rate * 100)}%`
  const auto: { key: string; label: string; group: Group; done: boolean; detail: string }[] = [
    { key: 'women_20', label: '20 verified women', group: 'women', done: m.gates.women20, detail: `${women} of 20 verified women` },
    { key: 'women_30', label: '30 verified women', group: 'women', done: m.gates.women30, detail: `${women} of 30 verified women` },
    { key: 'week2_women_15', label: '15 women returned in week two', group: 'quality', done: m.returnedWeek2.women >= 15, detail: `${m.returnedWeek2.women} of 15 women returned` },
    { key: 'friends_10', label: '10 friends brought by members', group: 'quality', done: m.gates.friends10, detail: `${m.friendsBrought} of 10 friends brought` },
    { key: 'acceptance_20', label: 'Acceptance rate at least 20%', group: 'quality', done: m.gates.acceptance20, detail: `${pct} accepted across ${sent} requests (needs 300 requests)` },
    { key: 'acceptance_30', label: 'Acceptance rate at least 30%', group: 'quality', done: m.gates.acceptance30, detail: `${pct} accepted across ${sent} requests (needs 300 requests)` },
  ]
  const rows = db.prepare('SELECT key, done, note, done_at, by FROM milestones').all() as MilestoneRow[]
  const byKey = new Map(rows.map((r) => [r.key, r]))
  const items = [
    ...auto.map((a) => ({ key: a.key, label: a.label, kind: 'auto' as const, group: a.group, done: a.done, detail: a.detail, note: null as string | null, doneAt: null as string | null })),
    ...MANUAL.map((x) => {
      const r = byKey.get(x.key)
      return { key: x.key, label: x.label, kind: 'manual' as const, group: x.group, done: !!r?.done, detail: x.detail, note: r?.note ?? null, doneAt: r?.done ? r.done_at : null }
    }),
  ]
  const startedRaw = readSetting<string>('beta_started_at') ?? ''
  const startMs = startedRaw ? Date.parse(startedRaw) : NaN
  const started = Number.isFinite(startMs)
  const doneCount = items.filter((i) => i.done).length
  const stage = !started ? 'prepare'
    : readSetting<boolean>('stage_paid_test') ? 'paid_test'
    : doneCount === items.length ? 'gate_ready'
    : 'free_beta'
  const first = items.find((i) => !i.done)
  return {
    stage: stage as 'prepare' | 'free_beta' | 'gate_ready' | 'paid_test',
    betaStartedAt: started ? startedRaw : null,
    day: started ? Math.max(1, Math.floor((Date.now() - startMs) / DAY_MS) + 1) : null,
    paidTestEarliest: started ? new Date(startMs + 35 * DAY_MS).toISOString() : null,
    items,
    next: first ? { key: first.key, label: first.label } : null,
    doneCount,
    total: items.length,
  }
}

export async function trackingRoutes(app: FastifyInstance) {
  const admin = { ...authed, preHandler: [requireAdmin] }

  // ---- public ----------------------------------------------------------------
  app.post('/v0/track/click', rateLimit(60, '1 minute'), async (req, reply) => {
    const body = z.object({ code: z.string().max(40) }).safeParse(req.body)
    if (body.success) {
      try {
        const c = db.prepare('SELECT id FROM campaigns WHERE code = ?').get(normCode(body.data.code)) as { id: string } | undefined
        if (c) {
          db.prepare('INSERT INTO campaign_clicks (campaign_id, day, count) VALUES (?, ?, 1) ON CONFLICT(campaign_id, day) DO UPDATE SET count = count + 1')
            .run(c.id, today())
        }
      } catch { /* never fail a click */ }
    }
    return reply.code(204).send()
  })

  app.post('/v0/waitlist', rateLimit(10, '1 hour'), async (req, reply) => {
    const body = z.object({
      email: z.string().trim().email().max(254),
      city: z.string().trim().max(60).optional(),
      gender: z.enum(['woman', 'man', 'other']).optional(),
      source: z.string().trim().max(60).optional(),
    }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' })
    const d = body.data
    const r = db.prepare('INSERT OR IGNORE INTO waitlist (email, city, gender, source, created_at) VALUES (?,?,?,?,?)')
      .run(d.email.toLowerCase(), d.city ?? '', d.gender ?? null, d.source ?? '', new Date().toISOString())
    if (r.changes > 0) track('waitlist_joined', null, { gender: d.gender ?? null })
    return { ok: true }
  })

  // ---- campaigns -------------------------------------------------------------
  const loadCampaign = (id: string) => db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as CampaignRow | undefined

  app.get('/v0/admin/campaigns', admin, async () => {
    const rows = db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC, rowid DESC').all() as CampaignRow[]
    return { campaigns: rows.map(campaignJson) }
  })

  app.post('/v0/admin/campaigns', admin, async (req, reply) => {
    const body = createCampaign.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' })
    const d = body.data
    const id = newId()
    const now = new Date().toISOString()
    let code = ''
    tx(() => {
      for (let i = 0; i < 10 && !code; i++) {
        const c = genCode()
        if (db.prepare('SELECT 1 FROM invite_codes WHERE code = ?').get(c)) continue
        code = c
      }
      if (!code) throw new Error('code_generation_failed')
      db.prepare('INSERT INTO campaigns (id,name,platform,topic,notes,cost_paise,posted_at,code,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(id, d.name, d.platform, d.topic ?? '', d.notes ?? '', d.costPaise ?? 0, normPostedAt(d.postedAt), code, now)
      db.prepare('INSERT INTO invite_codes (code,label,max_uses,uses,created_by,created_at,campaign_id) VALUES (?,?,?,0,NULL,?,?)')
        .run(code, d.name, 1_000_000, Date.now(), id)
      audit(req.user.sub, 'campaign.create', null, { campaignId: id, platform: d.platform })
    })
    return campaignJson(loadCampaign(id)!)
  })

  app.patch('/v0/admin/campaigns/:id', admin, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const body = patchCampaign.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' })
    const c = loadCampaign(id)
    if (!c) return reply.code(404).send({ error: 'not_found' })
    const d = body.data
    tx(() => {
      db.prepare('UPDATE campaigns SET name=?, platform=?, topic=?, notes=?, cost_paise=?, posted_at=? WHERE id=?').run(
        d.name ?? c.name, d.platform ?? c.platform, d.topic ?? c.topic, d.notes ?? c.notes, d.costPaise ?? c.cost_paise,
        d.postedAt === undefined ? c.posted_at : normPostedAt(d.postedAt), id,
      )
      if (d.name) db.prepare('UPDATE invite_codes SET label = ? WHERE campaign_id = ?').run(d.name, id)
      audit(req.user.sub, 'campaign.update', null, { campaignId: id })
    })
    return campaignJson(loadCampaign(id)!)
  })

  app.delete('/v0/admin/campaigns/:id', admin, async (req, reply) => {
    const id = (req.params as { id: string }).id
    if (!loadCampaign(id)) return reply.code(404).send({ error: 'not_found' })
    tx(() => {
      // Members who came through it keep their source columns; the code stops accepting signups.
      db.prepare('UPDATE invite_codes SET max_uses = uses WHERE campaign_id = ?').run(id)
      db.prepare('DELETE FROM campaign_clicks WHERE campaign_id = ?').run(id)
      db.prepare('DELETE FROM campaigns WHERE id = ?').run(id)
      audit(req.user.sub, 'campaign.delete', null, { campaignId: id })
    })
    return { ok: true }
  })

  // ---- waitlist --------------------------------------------------------------
  app.get('/v0/admin/waitlist', admin, async () => {
    const total = num('SELECT COUNT(*) AS n FROM waitlist')
    const byCity = (db.prepare(`
      SELECT city, COUNT(*) AS count FROM waitlist WHERE city != '' GROUP BY lower(city) ORDER BY count DESC, city LIMIT 50`).all() as { city: string; count: number }[])
      .map((r) => ({ city: r.city, count: r.count }))
    const g = (x: string) => num('SELECT COUNT(*) AS n FROM waitlist WHERE gender = ?', x)
    const women = g('woman'), men = g('man')
    const recent = db.prepare('SELECT email, city, gender, source, created_at FROM waitlist ORDER BY id DESC LIMIT 100').all() as any[]
    return {
      total, byCity,
      byGender: { women, men, other: total - women - men },
      recent: recent.map((r) => ({ email: r.email as string, city: r.city as string, gender: r.gender as string | null, source: r.source as string, createdAt: r.created_at as string })),
    }
  })

  // ---- growth rollups --------------------------------------------------------
  app.get('/v0/admin/growth', admin, async () => {
    const camps = (db.prepare('SELECT * FROM campaigns').all() as CampaignRow[]).map(campaignJson)
    const byPlat = new Map<string, { platform: string; campaigns: number; clicks: number; signups: number; verified: number; women: number; men: number }>()
    for (const c of camps) {
      const key = c.platform.trim().toLowerCase() || 'other'
      const p = byPlat.get(key) ?? { platform: c.platform, campaigns: 0, clicks: 0, signups: 0, verified: 0, women: 0, men: 0 }
      p.campaigns += 1; p.clicks += c.clicks; p.signups += c.signups; p.verified += c.verified; p.women += c.women; p.men += c.men
      byPlat.set(key, p)
    }
    const days = (db.prepare(`
      SELECT CAST(strftime('%w', created_at / 1000, 'unixepoch') AS INTEGER) AS weekday,
             COUNT(*) AS signups,
             SUM(CASE WHEN status = 'active' AND gender = 'woman' THEN 1 ELSE 0 END) AS verifiedWomen
      FROM users WHERE role != 'admin' GROUP BY weekday`).all() as { weekday: number; signups: number; verifiedWomen: number | null }[])
    const byWeekday = Array.from({ length: 7 }, (_, weekday) => {
      const r = days.find((d) => d.weekday === weekday)
      return { weekday, signups: r?.signups ?? 0, verifiedWomen: r?.verifiedWomen ?? 0 }
    })
    const total = num('SELECT COUNT(*) AS n FROM waitlist')
    const byCity = (db.prepare(`
      SELECT city, COUNT(*) AS count FROM waitlist WHERE city != '' GROUP BY lower(city) ORDER BY count DESC, city LIMIT 50`).all() as { city: string; count: number }[])
      .map((r) => ({ city: r.city, count: r.count }))
    const women = num("SELECT COUNT(*) AS n FROM waitlist WHERE gender = 'woman'")
    const men = num("SELECT COUNT(*) AS n FROM waitlist WHERE gender = 'man'")
    return { byPlatform: [...byPlat.values()], byWeekday, waitlist: { total, byCity, byGender: { women, men, other: total - women - men } } }
  })

  // ---- launch tracker --------------------------------------------------------
  app.get('/v0/admin/launch', admin, async () => launchState())

  app.put('/v0/admin/launch', admin, async (req, reply) => {
    const body = z.object({ betaStartedAt: z.string().trim().max(40).nullable(), paidTest: z.boolean().optional() }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' })
    const { betaStartedAt, paidTest } = body.data
    if (betaStartedAt && !Number.isFinite(Date.parse(betaStartedAt))) return reply.code(400).send({ error: 'invalid_input' })
    tx(() => {
      writeSetting('beta_started_at', betaStartedAt ?? '')
      if (paidTest !== undefined) writeSetting('stage_paid_test', paidTest)
      audit(req.user.sub, 'launch.update', null, { betaStartedAt: betaStartedAt ?? '', ...(paidTest !== undefined ? { paidTest } : {}) })
    })
    return launchState()
  })

  app.put('/v0/admin/milestones/:key', admin, async (req, reply) => {
    const key = (req.params as { key: string }).key
    const body = z.object({ done: z.boolean(), note: z.string().trim().max(500).optional() }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' })
    if (AUTO_KEYS.includes(key)) return reply.code(400).send({ error: 'auto_item' })
    if (!MANUAL.some((m) => m.key === key)) return reply.code(404).send({ error: 'not_found' })
    const { done, note } = body.data
    tx(() => {
      const prev = db.prepare('SELECT note FROM milestones WHERE key = ?').get(key) as { note: string | null } | undefined
      db.prepare(`
        INSERT INTO milestones (key, done, note, done_at, by) VALUES (?,?,?,?,?)
        ON CONFLICT(key) DO UPDATE SET done = excluded.done, note = excluded.note, done_at = excluded.done_at, by = excluded.by`)
        .run(key, done ? 1 : 0, note !== undefined ? (note || null) : prev?.note ?? null, done ? new Date().toISOString() : null, req.user.sub)
      audit(req.user.sub, 'launch.milestone', null, { key, done })
    })
    return launchState().items.find((i) => i.key === key)
  })

  // ---- users overview --------------------------------------------------------
  app.get('/v0/admin/users-overview', admin, async () => {
    const dayAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10)
    const activeIn = (n: number) => {
      const rows = db.prepare(`
        SELECT u.gender AS g, COUNT(DISTINCT a.user_id) AS n FROM user_activity a JOIN users u ON u.id = a.user_id
        WHERE a.day >= ? AND u.role = 'user' AND u.status != 'deleted' GROUP BY u.gender`).all(dayAgo(n - 1)) as { g: string | null; n: number }[]
      const women = rows.find((r) => r.g === 'woman')?.n ?? 0
      const men = rows.find((r) => r.g === 'man')?.n ?? 0
      return { women, men, total: rows.reduce((s, r) => s + r.n, 0) }
    }
    const byStatus: Record<string, number> = { unverified: 0, pending: 0, active: 0, rejected: 0, deleted: 0 }
    for (const r of db.prepare("SELECT status, COUNT(*) AS n FROM users WHERE role = 'user' GROUP BY status").all() as { status: string; n: number }[]) {
      byStatus[r.status] = r.n
    }
    const per = new Map<string, number>()
    for (const r of db.prepare("SELECT date(created_at / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM users WHERE role = 'user' AND created_at >= ? GROUP BY day")
      .all(Date.now() - 31 * DAY_MS) as { day: string; n: number }[]) per.set(r.day, r.n)
    const signupsPerDay = Array.from({ length: 30 }, (_, i) => {
      const day = dayAgo(29 - i)
      return { day, count: per.get(day) ?? 0 }
    })
    const funnel = [
      { key: 'signed_up', step: 'Signed up', count: num("SELECT COUNT(*) AS n FROM users WHERE role = 'user'") },
      { key: 'terms_agreed', step: 'Agreed to terms', count: num("SELECT COUNT(*) AS n FROM users WHERE role = 'user' AND terms_agreed_at IS NOT NULL") },
      { key: 'profile_done', step: 'Profile completed', count: num("SELECT COUNT(DISTINCT e.user_id) AS n FROM events e JOIN users u ON u.id = e.user_id WHERE e.type = 'profile_completed' AND u.role = 'user'") },
      { key: 'verification_sent', step: 'Verification sent', count: num("SELECT COUNT(DISTINCT v.user_id) AS n FROM verifications v JOIN users u ON u.id = v.user_id WHERE u.role = 'user'") },
      { key: 'verified', step: 'Verified', count: num("SELECT COUNT(*) AS n FROM users WHERE role = 'user' AND status = 'active'") },
      { key: 'first_request', step: 'First request', count: num(`
        SELECT COUNT(*) AS n FROM users u WHERE u.role = 'user' AND (EXISTS (SELECT 1 FROM requests r WHERE r.from_id = u.id) OR EXISTS (SELECT 1 FROM requests r WHERE r.to_id = u.id))`) },
    ]
    const kinds: Record<string, number> = { campaign: 0, member: 0, batch: 0, direct: 0 }
    for (const r of db.prepare("SELECT COALESCE(source_kind, 'direct') AS k, COUNT(*) AS n FROM users WHERE role = 'user' GROUP BY k").all() as { k: string; n: number }[]) {
      kinds[r.k] = (kinds[r.k] ?? 0) + r.n
    }
    const batches = (db.prepare(`
      SELECT source_ref AS label, COUNT(*) AS uses, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS verified
      FROM users WHERE source_kind = 'batch' AND role = 'user' GROUP BY source_ref ORDER BY uses DESC, label`).all() as any[])
      .map((r) => ({ label: (r.label as string | null) ?? '', uses: r.uses as number, verified: r.verified as number }))
    const topInviters = (db.prepare(`
      SELECT i.member_id AS member_id, COUNT(*) AS friends, SUM(CASE WHEN u.status = 'active' THEN 1 ELSE 0 END) AS verified
      FROM users u JOIN users i ON i.id = u.source_ref
      WHERE u.source_kind = 'member' AND u.role = 'user' GROUP BY i.id ORDER BY friends DESC, i.created_at LIMIT 10`).all() as any[])
      .map((r) => ({ memberId: r.member_id as string, friends: r.friends as number, verified: r.verified as number }))
    return {
      active: { d1: activeIn(1), d7: activeIn(7), d30: activeIn(30) },
      byStatus, signupsPerDay, funnel,
      sources: { byKind: kinds, batches, topInviters },
    }
  })

  // ---- health ----------------------------------------------------------------
  app.get('/v0/admin/health', admin, async () => {
    const now = Date.now()
    const m = computeMetrics()
    const { sent, accepted, declined, pending, acceptanceRate } = m.requests

    const replyHours = (db.prepare('SELECT created_at, decided_at FROM requests WHERE decided_at IS NOT NULL').all() as { created_at: number; decided_at: number }[])
      .map((r) => (r.decided_at - r.created_at) / HOUR_MS)
    const medianReplyHours = median(replyHours)
    const womenWithUnanswered = num(`
      SELECT COUNT(DISTINCT r.to_id) AS n FROM requests r JOIN users u ON u.id = r.to_id
      WHERE r.status = 'pending' AND r.created_at < ? AND u.status != 'deleted'`, now - 72 * HOUR_MS)
    const menZeroAccepted = num(`
      SELECT COUNT(*) AS n FROM (
        SELECT r.from_id FROM requests r GROUP BY r.from_id
        HAVING COUNT(*) >= 3 AND SUM(CASE WHEN r.status = 'accepted' THEN 1 ELSE 0 END) = 0)`)
    const chatsStarted = num('SELECT COUNT(DISTINCT connection_id) AS n FROM messages')
    const totalMessages = num('SELECT COUNT(*) AS n FROM messages')
    const voiceMessages = num("SELECT COUNT(*) AS n FROM messages WHERE kind = 'voice'")

    const retention = (fromDay: number) => {
      const out = { women: 0, men: 0 }
      for (const [g, key] of [['woman', 'women'], ['man', 'men']] as const) {
        const old = num("SELECT COUNT(*) AS n FROM users WHERE role = 'user' AND gender = ? AND status != 'deleted' AND created_at <= ?", g, now - fromDay * DAY_MS)
        if (!old) continue
        const back = num(`
          SELECT COUNT(*) AS n FROM users u WHERE u.role = 'user' AND u.gender = ? AND u.status != 'deleted' AND u.created_at <= ?
            AND EXISTS (SELECT 1 FROM user_activity a WHERE a.user_id = u.id
              AND julianday(a.day) - julianday(date(u.created_at / 1000, 'unixepoch')) BETWEEN ? AND ?)`, g, now - fromDay * DAY_MS, fromDay, fromDay + 6)
        out[key] = round2(back / old)
      }
      return out
    }

    const reviewedReports = (db.prepare('SELECT created_at, reviewed_at FROM reports WHERE reviewed_at IS NOT NULL').all() as { created_at: number; reviewed_at: number }[])
      .map((r) => (r.reviewed_at - r.created_at) / HOUR_MS)
    const openReports = num("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'")
    const safety = {
      openReports,
      repeatReported: num('SELECT COUNT(*) AS n FROM (SELECT reported_id FROM reports GROUP BY reported_id HAVING COUNT(DISTINCT reporter_id) >= 2)'),
      medianReportResponseHours: median(reviewedReports),
      suspended: num('SELECT COUNT(*) AS n FROM suspensions'),
      blocks: num('SELECT COUNT(*) AS n FROM blocks'),
      deletionRequests: num('SELECT COUNT(*) AS n FROM account_state WHERE delete_requested_at IS NOT NULL AND purged_at IS NULL'),
    }

    const pay = (s: string) => num('SELECT COUNT(*) AS n FROM payments WHERE status = ?', s)
    const money = {
      pending: pay('pending'), approved: pay('approved'), rejected: pay('rejected'),
      // Net of refunds. The caps are the admin's settings; null means no limit.
      revenuePaise: num("SELECT COALESCE(SUM(amount_paise - refunded_paise), 0) AS n FROM payments WHERE status = 'approved'"),
      refundedPaise: num("SELECT COALESCE(SUM(refunded_paise), 0) AS n FROM payments WHERE status = 'approved'"),
      capPaise: getSettings().pay_cap_rupees > 0 ? getSettings().pay_cap_rupees * 100 : null,
      capMen: getSettings().pay_cap_men > 0 ? getSettings().pay_cap_men : null,
      paidMen: num("SELECT COUNT(DISTINCT user_id) AS n FROM payments WHERE status = 'approved' AND amount_paise - refunded_paise > 0"),
    }

    const alerts: { level: 'warn' | 'info'; key: string; text: string }[] = []
    const oldVer = num("SELECT COUNT(*) AS n FROM verifications WHERE status = 'pending' AND created_at < ?", now - 48 * HOUR_MS)
    if (oldVer) alerts.push({ level: 'warn', key: 'verification_queue', text: `${oldVer} verification${oldVer === 1 ? '' : 's'} waiting more than 48 hours` })
    const oldRep = num("SELECT COUNT(*) AS n FROM reports WHERE status = 'open' AND created_at < ?", now - DAY_MS)
    if (oldRep) alerts.push({ level: 'warn', key: 'report_open', text: `${oldRep} open report${oldRep === 1 ? '' : 's'} older than 24 hours` })
    const s = getSettings()
    for (const [g, cap, key] of [['woman', s.cap_women, 'cap_women'], ['man', s.cap_men, 'cap_men']] as const) {
      if (cap <= 0) continue
      const n = num("SELECT COUNT(*) AS n FROM users WHERE gender = ? AND status != 'deleted' AND role != 'admin'", g)
      if (n >= cap * 0.9) alerts.push({ level: 'warn', key, text: `${g === 'woman' ? 'Women' : 'Men'} cap is ${Math.round((n / cap) * 100)}% full (${n} of ${cap})` })
    }
    const cheapest = Math.min(...getPlans().map((p) => p.amountPaise))
    const sales = salesState(undefined, cheapest)
    if (sales.closed) alerts.push({ level: 'warn', key: 'pay_cap', text: sales.closed === 'men' ? 'Pack sales are paused: the limit on paying men is reached' : 'Pack sales are paused: the limit on total sales is reached' })
    const activeW = num("SELECT COUNT(*) AS n FROM users WHERE role = 'user' AND status = 'active' AND gender = 'woman'")
    const activeAll = num("SELECT COUNT(*) AS n FROM users WHERE role = 'user' AND status = 'active'")
    if (activeAll >= 20 && activeW / activeAll < 0.4) {
      alerts.push({ level: 'warn', key: 'women_share', text: `Women are ${Math.round((activeW / activeAll) * 100)}% of active members (under 40%)` })
    }
    const menExist = num("SELECT COUNT(*) AS n FROM users WHERE role = 'user' AND gender = 'man' AND status != 'deleted'")
    if (menExist > 0 && activeW === 0) alerts.push({ level: 'warn', key: 'no_women_verified', text: 'Men have signed up but no woman is verified yet' })

    return {
      marketplace: {
        requests: { sent, accepted, declined, pending, acceptanceRate },
        medianReplyHours: medianReplyHours === null ? null : round2(medianReplyHours),
        womenWithUnanswered, menZeroAccepted, chatsStarted,
        messagesPerChat: chatsStarted ? round2(totalMessages / chatsStarted) : 0,
        voiceMessages,
        retention: { week1: retention(7), week2: retention(14) },
      },
      safety: { ...safety, medianReportResponseHours: safety.medianReportResponseHours === null ? null : round2(safety.medianReportResponseHours) },
      money, alerts,
    }
  })
}
