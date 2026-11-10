import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const PORT = 4637 + Math.floor(Math.random() * 100)
const BASE = `http://127.0.0.1:${PORT}/v0`
let proc: ChildProcess
let dir: string
let dbPath: string
let db: DatabaseSync
const PW = 'Tr0ub4dor&3xKq'

const call = (method: string, url: string, token?: string, json?: unknown) =>
  fetch(BASE + url, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(json !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  })
const j = async (r: Response) => (await r.json()) as any

const signupRaw = (email: string, gender: 'man' | 'woman', inviteCode?: string) =>
  call('POST', '/signup', undefined, { agreeToTerms: true, email, password: PW, name: 'Nm' + email.split('@')[0], age: 30, gender, ...(inviteCode !== undefined ? { inviteCode } : {}) })
const signup = async (email: string, gender: 'man' | 'woman' = 'man', inviteCode?: string) => {
  const r = await signupRaw(email, gender, inviteCode)
  assert.equal(r.status, 200)
  return (await r.json()) as { token: string; user: { memberId: string } }
}
const uid = (email: string) => (db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }).id
const events = (type: string) => db.prepare('SELECT * FROM events WHERE type = ? ORDER BY id').all(type) as any[]
const userRow = (email: string) => ({ ...(db.prepare('SELECT source_kind, source_ref FROM users WHERE email = ?').get(email) as { source_kind: string; source_ref: string | null }) })

let admin: { token: string }

async function submitVerification(token: string) {
  const fd = new FormData()
  fd.append('selfie', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], { type: 'image/jpeg' }), 's.jpg')
  fd.append('voice', new Blob([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6])], { type: 'audio/webm' }), 'v.webm')
  const r = await fetch(BASE + '/verification', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd })
  assert.equal(r.status, 201)
}
async function verifyViaAdmin(email: string) {
  const id = (db.prepare("SELECT id FROM verifications WHERE user_id = ? AND status = 'pending'").get(uid(email)) as { id: string }).id
  const r = await call('POST', `/admin/verifications/${id}/decision`, admin.token, { decision: 'approve' })
  assert.equal(r.status, 200)
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'connectly-track-'))
  dbPath = path.join(dir, 't.db')
  proc = spawn(process.execPath, ['src/server.ts'], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, UPLOAD_DIR: path.join(dir, 'up'), ADMIN_EMAILS: 'admin@x.test', RATE_LIMIT: 'off' },
    stdio: 'ignore',
  })
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100))
  }
  admin = await signup('admin@x.test', 'man')
  db = new DatabaseSync(dbPath)
})
after(async () => { db.close(); proc.kill(); await rm(dir, { recursive: true, force: true }) })

describe('event log', () => {
  it('records the signup, verification, request and chat flow without PII', async () => {
    const m = await signup('mm@x.test', 'man')
    const w = await signup('ww@x.test', 'woman')
    assert.equal(events('signup').filter((e) => e.user_id === uid('mm@x.test')).length, 1)
    assert.equal(events('terms_agreed').length >= 2, true)
    assert.equal(events('profile_completed').filter((e) => e.user_id === uid('ww@x.test')).length, 0)
    await call('PATCH', '/me', w.token, { city: 'Hyderabad', bio: 'Hello there' })
    await call('PATCH', '/me', w.token, { city: 'Hyderabad', bio: 'Hello there again' })
    assert.equal(events('profile_completed').filter((e) => e.user_id === uid('ww@x.test')).length, 1)

    await submitVerification(m.token)
    await submitVerification(w.token)
    assert.equal(events('verification_submitted').length >= 2, true)
    await verifyViaAdmin('mm@x.test')
    await verifyViaAdmin('ww@x.test')
    assert.equal(events('verified').length, 2)
    assert.equal((await call('POST', '/login', undefined, { email: 'mm@x.test', password: PW })).status, 200)
    assert.equal(events('login').filter((e) => e.user_id === uid('mm@x.test')).length, 1)

    db.prepare("UPDATE users SET request_credits = 5 WHERE email = 'mm@x.test'").run()
    const rq = await call('POST', '/requests', m.token, { memberId: w.user.memberId, note: 'a private note about hiking' })
    assert.equal(rq.status, 201)
    const { id } = await j(rq)
    const inbox = await j(await call('GET', '/requests/received', w.token))
    assert.equal(inbox[0].id, id)
    assert.equal((await call('POST', `/requests/${id}/decision`, w.token, { decision: 'accept' })).status, 200)
    const conn = (await j(await call('GET', '/connections', m.token)))[0].id
    await call('POST', `/connections/${conn}/messages`, m.token, { body: 'secret message text xyz' })
    await call('POST', `/connections/${conn}/messages`, w.token, { body: 'second secret reply' })
    assert.equal(events('request_sent').length, 1)
    assert.equal(events('request_accepted').length, 1)
    assert.equal(events('chat_started').length, 1)
    const msgs = events('message_sent')
    assert.equal(msgs.length, 2)
    assert.equal(JSON.parse(msgs[0].meta).kind, 'text')

    const all = db.prepare('SELECT meta FROM events').all() as { meta: string }[]
    const blob = all.map((e) => e.meta).join('\n')
    for (const bad of ['@x.test', 'Nmmm', 'Nmww', 'secret', 'hiking', 'Hyderabad']) assert.ok(!blob.includes(bad), `meta leaked ${bad}`)
    assert.ok(db.prepare('SELECT created_at FROM events LIMIT 1').get() as any)
    assert.match((db.prepare('SELECT created_at FROM events LIMIT 1').get() as any).created_at, /^\d{4}-\d\d-\d\dT/)
  })

  it('records report, block, account and payment events', async () => {
    const a = await signup('ev1@x.test', 'man')
    const b = await signup('ev2@x.test', 'woman')
    db.prepare("UPDATE users SET status='active' WHERE email IN ('ev1@x.test','ev2@x.test')").run()
    assert.equal((await call('POST', '/blocks', a.token, { memberId: b.user.memberId })).status, 200)
    assert.equal((await call('POST', '/reports', a.token, { memberId: b.user.memberId, reason: 'spam' })).status, 201)
    assert.equal(events('block_made').length, 1)
    assert.equal(events('report_filed').length, 1)
    const rep = (db.prepare("SELECT id FROM reports WHERE status='open'").get() as { id: string }).id
    assert.equal((await call('POST', `/admin/reports/${rep}/decision`, admin.token, { decision: 'action', note: 'ok', suspend: true })).status, 200)
    assert.equal(events('report_decided').length, 1)
    assert.equal((await call('POST', `/admin/suspensions/${b.user.memberId}/lift`, admin.token)).status, 200)
    assert.equal(events('suspension_lifted').length, 1)
    assert.equal((await call('POST', '/account/deactivate', a.token)).status, 200)
    await call('POST', '/account/deactivate', a.token)
    assert.equal(events('deactivated').length, 1)
    assert.equal((await call('POST', '/account/delete-request', b.token, { reason: 'private reason' })).status, 200)
    assert.equal(events('deletion_requested').length, 1)
    assert.ok(!events('deletion_requested')[0].meta.includes('private'))
  })
})

describe('source attribution', () => {
  it('direct, campaign, member and batch', async () => {
    await signup('d1@x.test', 'woman')
    assert.deepEqual(userRow('d1@x.test'), { source_kind: 'direct', source_ref: null })
    await signup('d2@x.test', 'woman', 'BADCODE1') // not invite-only: invalid code is fine
    assert.equal(userRow('d2@x.test').source_kind, 'direct')

    const camp = await j(await call('POST', '/admin/campaigns', admin.token, { name: 'Insta reel', platform: 'instagram' }))
    await signup('c1@x.test', 'woman', camp.code.toLowerCase())
    assert.deepEqual(userRow('c1@x.test'), { source_kind: 'campaign', source_ref: camp.id })

    const inv = await j(await call('GET', '/me/invite', (await signup('inv@x.test', 'man')).token))
    await signup('f1@x.test', 'woman', inv.code)
    assert.deepEqual(userRow('f1@x.test'), { source_kind: 'member', source_ref: uid('inv@x.test') })

    const batch = await j(await call('POST', '/admin/invites', admin.token, { count: 1, label: 'college-fest' }))
    await signup('b1@x.test', 'woman', batch.codes[0])
    assert.deepEqual(userRow('b1@x.test'), { source_kind: 'batch', source_ref: 'college-fest' })
    const used = events('invite_used').map((e) => JSON.parse(e.meta).kind).sort()
    assert.ok(used.includes('campaign') && used.includes('member') && used.includes('batch'))
  })
})

describe('campaigns', () => {
  it('CRUD, click counting and rollups', async () => {
    assert.equal((await call('GET', '/admin/campaigns')).status, 401)
    assert.equal((await call('GET', '/admin/campaigns', (await signup('na@x.test', 'man')).token)).status, 403)
    assert.equal((await call('POST', '/admin/campaigns', admin.token, { name: 'x' })).status, 400)
    const c = await j(await call('POST', '/admin/campaigns', admin.token, { name: 'YT short', platform: 'youtube', topic: 'launch', costPaise: 100000, postedAt: '2026-11-01' }))
    assert.deepEqual(Object.keys(c).sort(), ['clicks', 'code', 'costPaise', 'costPerVerifiedPaise', 'createdAt', 'id', 'men', 'name', 'notes', 'platform', 'postedAt', 'signups', 'topic', 'verified', 'women'])
    assert.equal(c.costPerVerifiedPaise, null)
    const ic = db.prepare('SELECT campaign_id, max_uses, label FROM invite_codes WHERE code = ?').get(c.code) as any
    assert.deepEqual({ ...ic }, { campaign_id: c.id, max_uses: 1000000, label: 'YT short' })

    for (const code of [c.code, c.code.toLowerCase(), 'UNKNOWN1']) {
      assert.equal((await call('POST', '/track/click', undefined, { code })).status, 204)
    }
    assert.equal((await call('POST', '/track/click', undefined, { nope: 1 })).status, 204)
    await signup('cw1@x.test', 'woman', c.code)
    await signup('cm1@x.test', 'man', c.code)
    db.prepare("UPDATE users SET status='active' WHERE email='cw1@x.test'").run()
    const list = (await j(await call('GET', '/admin/campaigns', admin.token))).campaigns as any[]
    const got = list.find((x) => x.id === c.id)
    assert.equal(got.clicks, 2)
    assert.equal(got.signups, 2)
    assert.equal(got.verified, 1)
    assert.equal(got.women, 1)
    assert.equal(got.men, 1)
    assert.equal(got.costPerVerifiedPaise, 100000)

    const p = await j(await call('PATCH', `/admin/campaigns/${c.id}`, admin.token, { costPaise: 50000, notes: 'n', name: 'YT renamed' }))
    assert.equal(p.costPaise, 50000)
    assert.equal(p.costPerVerifiedPaise, 50000)
    assert.equal(p.platform, 'youtube')
    assert.equal((await call('PATCH', '/admin/campaigns/nope', admin.token, { notes: 'x' })).status, 404)

    assert.deepEqual(await j(await call('DELETE', `/admin/campaigns/${c.id}`, admin.token)), { ok: true })
    assert.equal(userRow('cw1@x.test').source_kind, 'campaign')
    assert.equal((await signupRaw('late@x.test', 'woman', c.code)).status, 200) // not invite-only: falls back to direct
    assert.equal(userRow('late@x.test').source_kind, 'direct')
    assert.ok(!((await j(await call('GET', '/admin/campaigns', admin.token))).campaigns as any[]).some((x) => x.id === c.id))
  })

  it('growth rollups by platform and weekday', async () => {
    assert.equal((await call('GET', '/admin/growth')).status, 401)
    assert.equal((await call('GET', '/admin/growth', (await signup('gr0@x.test', 'man')).token)).status, 403)
    const c = await j(await call('POST', '/admin/campaigns', admin.token, { name: 'Toot', platform: 'Mastodon' }))
    await call('POST', '/track/click', undefined, { code: c.code })
    await signup('gr1@x.test', 'woman', c.code)
    db.prepare("UPDATE users SET status='active' WHERE email='gr1@x.test'").run()
    const g = await j(await call('GET', '/admin/growth', admin.token))
    assert.deepEqual(Object.keys(g).sort(), ['byPlatform', 'byWeekday', 'waitlist'])
    const ig = g.byPlatform.find((p: any) => p.platform === 'Mastodon')
    assert.deepEqual({ ...ig }, { platform: 'Mastodon', campaigns: 1, clicks: 1, signups: 1, verified: 1, women: 1, men: 0 })
    assert.equal(g.byWeekday.length, 7)
    assert.deepEqual(g.byWeekday.map((d: any) => d.weekday), [0, 1, 2, 3, 4, 5, 6])
    assert.ok(g.byWeekday.reduce((n: number, d: any) => n + d.signups, 0) >= 1)
    assert.ok(g.byWeekday.reduce((n: number, d: any) => n + d.verifiedWomen, 0) >= 1)
    assert.deepEqual(Object.keys(g.waitlist).sort(), ['byCity', 'byGender', 'total'])
  })
})

describe('waitlist', () => {
  it('dedupes by lowercased email and summarizes', async () => {
    assert.equal((await call('POST', '/waitlist', undefined, { email: 'not-an-email' })).status, 400)
    assert.deepEqual(await j(await call('POST', '/waitlist', undefined, { email: 'Wait@X.test', city: 'Pune', gender: 'woman', source: 'insta' })), { ok: true })
    assert.deepEqual(await j(await call('POST', '/waitlist', undefined, { email: 'wait@x.test' })), { ok: true })
    await call('POST', '/waitlist', undefined, { email: 'two@x.test', city: 'Pune', gender: 'man' })
    await call('POST', '/waitlist', undefined, { email: 'three@x.test' })
    assert.equal(events('waitlist_joined').length, 3)
    assert.ok(!events('waitlist_joined').some((e) => e.meta.includes('@')))
    const w = await j(await call('GET', '/admin/waitlist', admin.token))
    assert.equal(w.total, 3)
    assert.deepEqual(w.byCity, [{ city: 'Pune', count: 2 }])
    assert.deepEqual(w.byGender, { women: 1, men: 1, other: 1 })
    assert.equal(w.recent[0].email, 'three@x.test')
    assert.deepEqual(Object.keys(w.recent[0]).sort(), ['city', 'createdAt', 'email', 'gender', 'source'])
    assert.equal((await call('GET', '/admin/waitlist', (await signup('nb@x.test', 'man')).token)).status, 403)
  })
})

describe('launch tracker', () => {
  it('stage, items, next and milestones', async () => {
    let l = await j(await call('GET', '/admin/launch', admin.token))
    assert.equal(l.stage, 'prepare')
    assert.equal(l.betaStartedAt, null)
    assert.equal(l.day, null)
    assert.equal(l.paidTestEarliest, null)
    assert.equal(l.total, 16)
    assert.equal(l.items.length, 16)
    assert.equal(l.next.key, 'women_20')
    assert.deepEqual(Object.keys(l.items[0]).sort(), ['detail', 'doneAt', 'done', 'group', 'key', 'kind', 'label', 'note'].sort())

    const start = new Date(Date.now() - 2 * 86400_000).toISOString()
    l = await j(await call('PUT', '/admin/launch', admin.token, { betaStartedAt: start }))
    assert.equal(l.stage, 'free_beta')
    assert.equal(l.day, 3)
    assert.equal(l.paidTestEarliest, new Date(Date.parse(start) + 35 * 86400_000).toISOString())
    assert.equal((await call('PUT', '/admin/launch', admin.token, { betaStartedAt: 'garbage' })).status, 400)

    assert.equal((await call('PUT', '/admin/milestones/women_20', admin.token, { done: true })).status, 400)
    assert.equal((await call('PUT', '/admin/milestones/bogus', admin.token, { done: true })).status, 404)
    const it1 = await j(await call('PUT', '/admin/milestones/counsel_review', admin.token, { done: true, note: 'Signed off' }))
    assert.equal(it1.done, true)
    assert.equal(it1.note, 'Signed off')
    assert.ok(it1.doneAt)
    assert.ok(db.prepare("SELECT 1 FROM admin_audit WHERE action = 'launch.milestone'").get())
    const it2 = await j(await call('PUT', '/admin/milestones/counsel_review', admin.token, { done: false }))
    assert.equal(it2.done, false)
    assert.equal(it2.doneAt, null)

    // Auto items follow the metrics; the next item moves past finished ones.
    db.prepare('UPDATE users SET status = ? WHERE gender = ?').run('active', 'woman')
    const have = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE gender='woman' AND status='active'").get() as { n: number }).n
    const ins = db.prepare("INSERT INTO users (id,member_id,email,password_hash,name,age,gender,status,created_at) VALUES (?,?,?,?,?,?,'woman','active',?)")
    for (let i = have; i < 20; i++) ins.run(`seed-${i}`, `SD${i}`, `seed${i}@x.test`, 'x', 'S', 30, Date.now())
    l = await j(await call('GET', '/admin/launch', admin.token))
    assert.equal(l.items.find((i: any) => i.key === 'women_20').done, true)
    assert.equal(l.next.key, 'women_30')

    // gate_ready only when everything is done; paid_test comes from the flag.
    for (const m of ['counsel_review', 'name_cleared', 'trademark_search', 'harassment_playbook', 'deletion_drill', 'report_drill', 'real_phone_test', 'block_report_tested', 'runway_3_months', 'legal_text_final']) {
      await call('PUT', `/admin/milestones/${m}`, admin.token, { done: true })
    }
    l = await j(await call('GET', '/admin/launch', admin.token))
    assert.equal(l.stage, 'free_beta')
    assert.equal(l.doneCount, 11)
    l = await j(await call('PUT', '/admin/launch', admin.token, { betaStartedAt: start, paidTest: true }))
    assert.equal(l.stage, 'paid_test')
    l = await j(await call('PUT', '/admin/launch', admin.token, { betaStartedAt: null, paidTest: false }))
    assert.equal(l.stage, 'prepare')
  })
})

describe('overview and health', () => {
  it('users-overview shape and counts', async () => {
    const o = await j(await call('GET', '/admin/users-overview', admin.token))
    assert.deepEqual(Object.keys(o).sort(), ['active', 'byStatus', 'funnel', 'signupsPerDay', 'sources'])
    for (const k of ['d1', 'd7', 'd30']) assert.deepEqual(Object.keys(o.active[k]).sort(), ['men', 'total', 'women'])
    assert.ok(o.active.d1.total >= 1)
    for (const s of ['unverified', 'pending', 'active', 'rejected', 'deleted']) assert.equal(typeof o.byStatus[s], 'number')
    assert.equal(o.signupsPerDay.length, 30)
    assert.equal(o.signupsPerDay.at(-1).day, new Date().toISOString().slice(0, 10))
    assert.ok(o.signupsPerDay.at(-1).count >= 5)
    assert.deepEqual(o.funnel.map((f: any) => f.key), ['signed_up', 'terms_agreed', 'profile_done', 'verification_sent', 'verified', 'first_request'])
    assert.ok(o.funnel[0].count >= o.funnel[4].count)
    assert.equal(o.funnel[5].count, 2)
    assert.ok(o.sources.byKind.campaign >= 2 && o.sources.byKind.member >= 1 && o.sources.byKind.batch >= 1 && o.sources.byKind.direct >= 1)
    assert.deepEqual(o.sources.batches[0], { label: 'college-fest', uses: 1, verified: 1 })
    assert.equal(o.sources.topInviters.length, 1)
    assert.deepEqual(Object.keys(o.sources.topInviters[0]).sort(), ['friends', 'memberId', 'verified'])
  })

  it('health shape, alerts and numbers', async () => {
    db.prepare("UPDATE requests SET created_at = ?, decided_at = ? WHERE status = 'accepted'").run(Date.now() - 4 * 3600_000, Date.now() - 2 * 3600_000)
    const old = Date.now() - 100 * 3600_000
    db.prepare("INSERT INTO verifications (id,user_id,selfie_file,selfie_mime,voice_file,voice_mime,status,created_at) VALUES ('v-old',?, 'a','image/jpeg','b','audio/webm','pending',?)").run(uid('d1@x.test'), old)
    db.prepare("UPDATE users SET status='pending' WHERE email='d1@x.test'").run()
    db.prepare("INSERT INTO reports (id,reporter_id,reported_id,reason,status,created_at) VALUES ('r-old',?,?,'spam','open',?)").run(uid('f1@x.test'), uid('d2@x.test'), old)
    const h = await j(await call('GET', '/admin/health', admin.token))
    assert.deepEqual(Object.keys(h).sort(), ['alerts', 'marketplace', 'money', 'safety'])
    const mk = h.marketplace
    assert.equal(mk.requests.sent, 1)
    assert.equal(mk.requests.accepted, 1)
    assert.equal(mk.medianReplyHours, 2)
    assert.equal(mk.chatsStarted, 1)
    assert.equal(mk.messagesPerChat, 2)
    assert.equal(mk.voiceMessages, 0)
    assert.deepEqual(Object.keys(mk.retention.week1).sort(), ['men', 'women'])
    assert.deepEqual(mk.retention.week2, { women: 0, men: 0 })
    assert.equal(mk.womenWithUnanswered, 0)
    assert.equal(mk.menZeroAccepted, 0)
    assert.ok(h.safety.openReports >= 1)
    assert.equal(h.safety.blocks, 1)
    assert.equal(h.safety.suspended, 0)
    assert.equal(h.safety.deletionRequests, 1)
    assert.equal(h.safety.medianReportResponseHours === null || typeof h.safety.medianReportResponseHours === 'number', true)
    // no limits are set by default, so the caps read null (no limit)
    assert.deepEqual(h.money, { pending: 0, approved: 0, rejected: 0, revenuePaise: 0, refundedPaise: 0, capPaise: null, capMen: null, paidMen: 0 })
    const keys = h.alerts.map((a: any) => a.key)
    assert.ok(keys.includes('verification_queue'))
    assert.ok(keys.includes('report_open'))
    assert.ok(h.alerts.every((a: any) => (a.level === 'warn' || a.level === 'info') && typeof a.text === 'string'))
  })

  it('health unanswered, zero-accepted men, retention and cap alerts', async () => {
    const mkU = db.prepare("INSERT INTO users (id,member_id,email,password_hash,name,age,gender,status,created_at) VALUES (?,?,?,?,?,?,?,'active',?)")
    const longAgo = Date.now() - 20 * 86400_000
    mkU.run('hz-m', 'HZM', 'hzm@x.test', 'x', 'Z', 30, 'man', longAgo)
    for (let i = 0; i < 3; i++) {
      mkU.run(`hz-w${i}`, `HZW${i}`, `hzw${i}@x.test`, 'x', 'W', 30, 'woman', longAgo)
      db.prepare("INSERT INTO requests (id,from_id,to_id,status,created_at) VALUES (?,?,?,'pending',?)").run(`hz-r${i}`, 'hz-m', `hz-w${i}`, Date.now() - 80 * 3600_000)
    }
    db.prepare('INSERT INTO user_activity (user_id, day) VALUES (?,?)').run('hz-w0', new Date(longAgo + 8 * 86400_000).toISOString().slice(0, 10))
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('cap_men','5')").run()
    const h = await j(await call('GET', '/admin/health', admin.token))
    assert.equal(h.marketplace.womenWithUnanswered, 3)
    assert.equal(h.marketplace.menZeroAccepted, 1)
    assert.ok(h.marketplace.retention.week1.women > 0)
    assert.ok(h.alerts.some((a: any) => a.key === 'cap_men'))
  })
})
