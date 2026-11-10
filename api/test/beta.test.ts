import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const PORT = 4437 + Math.floor(Math.random() * 100)
const BASE = `http://127.0.0.1:${PORT}/v0`
let proc: ChildProcess
let dir: string
let dbPath: string
const PW = 'Tr0ub4dor&3xKq'

const call = (method: string, url: string, token?: string, json?: unknown) =>
  fetch(BASE + url, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(json !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  })
const j = async (r: Response) => (await r.json()) as any

const signupRaw = (email: string, gender: 'man' | 'woman', inviteCode?: string) =>
  call('POST', '/signup', undefined, { agreeToTerms: true, email, password: PW, name: 'N' + email.split('@')[0], age: 30, gender, ...(inviteCode !== undefined ? { inviteCode } : {}) })
const signup = async (email: string, gender: 'man' | 'woman' = 'man', inviteCode?: string) => {
  const r = await signupRaw(email, gender, inviteCode)
  assert.equal(r.status, 200)
  return (await r.json()) as { token: string; user: { memberId: string } }
}

let admin: { token: string }
const setSettings = async (patch: Record<string, unknown>) => {
  const cur = await j(await call('GET', '/admin/settings', admin.token))
  const r = await call('PUT', '/admin/settings', admin.token, { packs: cur.packs, payee: cur.payee, quickReasons: cur.quickReasons, ...patch })
  assert.equal(r.status, 200)
  return j(r)
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'connectly-beta-'))
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
})
after(async () => { proc.kill(); await rm(dir, { recursive: true, force: true }) })

describe('closed beta', () => {
  it('public-config reflects settings and needs no auth; settings validate', async () => {
    assert.deepEqual(await j(await call('GET', '/public-config')), { inviteOnly: false, betaFree: false, betaCity: '', supportEmail: '', supportWhatsapp: '' })
    const s = await setSettings({ invite_only: true, beta_city: 'Hyderabad', beta_free_requests: 3 })
    assert.equal(s.invite_only, true)
    assert.equal(s.beta_free_requests, 3)
    assert.deepEqual(await j(await call('GET', '/public-config')), { inviteOnly: true, betaFree: false, betaCity: 'Hyderabad', supportEmail: '', supportWhatsapp: '' })
    const cur = await j(await call('GET', '/admin/settings', admin.token))
    const bad = await call('PUT', '/admin/settings', admin.token, { packs: cur.packs, payee: cur.payee, quickReasons: cur.quickReasons, cap_men: -1 })
    assert.equal(bad.status, 400)
  })

  it('the admin page echoes the old values back; its new camelCase values still win', async () => {
    const cur = await j(await call('GET', '/admin/settings', admin.token))
    // exactly what the web page sends: everything it fetched (snake and camel), then the edited camelCase fields
    const r = await call('PUT', '/admin/settings', admin.token, { ...cur, betaFree: true, betaCity: 'Pune', capWomen: 40, capMen: 80, betaFreeRequests: 7, inviteOnly: false })
    assert.equal(r.status, 200)
    const out = await j(r)
    assert.deepEqual({ f: out.betaFree, c: out.betaCity, w: out.capWomen, m: out.capMen, n: out.betaFreeRequests, i: out.inviteOnly }, { f: true, c: 'Pune', w: 40, m: 80, n: 7, i: false })
    assert.deepEqual(await j(await call('GET', '/public-config')), { inviteOnly: false, betaFree: true, betaCity: 'Pune', supportEmail: '', supportWhatsapp: '' })
    await setSettings({ beta_free: false, beta_city: 'Hyderabad', cap_women: 0, cap_men: 0, beta_free_requests: 3, invite_only: true })
  })

  it('invite-only signup rejects bad codes and accepts a good one, once', async () => {
    for (const code of [undefined, '', 'NOPE1234']) {
      const r = await signupRaw('bad@x.test', 'woman', code)
      assert.equal(r.status, 400)
      assert.equal((await j(r)).error, 'invite_invalid')
    }
    assert.equal((await call('GET', '/admin/invites', admin.token)).status, 200)
    assert.equal((await call('POST', '/admin/invites', admin.token, { count: 0 })).status, 400)
    const made = await j(await call('POST', '/admin/invites', admin.token, { count: 2, label: 'launch' }))
    assert.equal(made.codes.length, 2)
    await signup('w1@x.test', 'woman', made.codes[0].toLowerCase())
    const again = await signupRaw('w2@x.test', 'woman', made.codes[0])
    assert.equal(again.status, 400)
    const list = await j(await call('GET', '/admin/invites', admin.token))
    const used = list.codes.find((c: any) => c.code === made.codes[0])
    assert.equal(used.uses, 1)
    assert.equal(used.label, 'launch')
    // the rejected signup consumed nothing and created no user
    assert.equal((await signupRaw('w2@x.test', 'woman', made.codes[1])).status, 200)
  })

  it('admin can delete invite codes; used, member and campaign codes are handled safely', async () => {
    const codeOf = async () => ((await j(await call('GET', '/admin/invites', admin.token))).codes as any[])
    const made = (await j(await call('POST', '/admin/invites', admin.token, { count: 3, label: 'del-batch' }))).codes as string[]
    const [unused, used, spare] = made as [string, string, string]
    const joiner = await signup('del-joiner@x.test', 'woman', used)

    // auth: nobody without an admin token can delete
    assert.equal((await call('DELETE', `/admin/invites/${unused}`)).status, 401)
    assert.equal((await call('DELETE', `/admin/invites/${unused}`, joiner.token)).status, 403)
    assert.equal((await call('POST', '/admin/invites/delete-unused', joiner.token)).status, 403)

    // delete one unused code: gone, and it no longer works for sign-up
    assert.deepEqual(await j(await call('DELETE', `/admin/invites/${unused.toLowerCase()}`, admin.token)), { ok: true })
    assert.ok(!(await codeOf()).some((c) => c.code === unused))
    const dead = await signupRaw('dead@x.test', 'woman', unused)
    assert.equal(dead.status, 400)
    assert.equal((await j(dead)).error, 'invite_invalid')
    assert.equal((await call('DELETE', `/admin/invites/${unused}`, admin.token)).status, 404)
    assert.equal((await call('DELETE', '/admin/invites/bad-code!', admin.token)).status, 400)

    // deleting a code that was used keeps the member who joined with it
    assert.deepEqual(await j(await call('DELETE', `/admin/invites/${used}`, admin.token)), { ok: true })
    assert.equal((await call('GET', '/me', joiner.token)).status, 200)

    // a campaign's code cannot be deleted here
    const camp = await j(await call('POST', '/admin/campaigns', admin.token, { name: 'Del test', platform: 'other' }))
    const r409 = await call('DELETE', `/admin/invites/${camp.code}`, admin.token)
    assert.equal(r409.status, 409)
    assert.equal((await j(r409)).error, 'campaign_code')
    const listed = (await codeOf()).find((c) => c.code === camp.code)
    assert.equal(listed.campaign, true)

    // delete-unused: removes only unused admin-made codes
    const host = await signup('del-host@x.test', 'woman', (await j(await call('POST', '/admin/invites', admin.token, { count: 1, label: 'host-entry' }))).codes[0])
    const personal = (await j(await call('GET', '/me/invite', host.token))).code as string
    const r = await j(await call('POST', '/admin/invites/delete-unused', admin.token))
    assert.ok(r.deleted >= 1)
    const after = await codeOf()
    assert.ok(!after.some((c) => c.code === spare), 'unused admin code removed')
    assert.ok(after.some((c) => c.code === personal), 'member code kept')
    assert.ok(after.some((c) => c.code === camp.code), 'campaign code kept')
    assert.ok(after.every((c) => c.uses > 0 || c.owner || c.campaign), 'no unused admin code left')
    assert.deepEqual(await j(await call('POST', '/admin/invites/delete-unused', admin.token)), { deleted: 0 })
  })

  it('personal code is stable, reusable and counts friends brought', async () => {
    const host = await signup('host@x.test', 'woman', (await j(await call('POST', '/admin/invites', admin.token, { count: 1 }))).codes[0])
    const inv = await j(await call('GET', '/me/invite', host.token))
    assert.equal(inv.friendsBrought, 0)
    assert.equal((await j(await call('GET', '/me/invite', host.token))).code, inv.code)
    await signup('f1@x.test', 'man', inv.code)
    await signup('f2@x.test', 'man', inv.code.toLowerCase())
    assert.equal((await j(await call('GET', '/me/invite', host.token))).friendsBrought, 2)
    assert.equal((await call('GET', '/me/invite')).status, 401)
  })

  it('caps return 409 beta_full at signup and when setting gender', async () => {
    await setSettings({ invite_only: false, cap_women: 0, cap_men: 0 })
    const db = new DatabaseSync(dbPath)
    const women = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE gender='woman'").get() as any).n
    await setSettings({ cap_women: women })
    const r = await signupRaw('late@x.test', 'woman')
    assert.equal(r.status, 409)
    assert.equal((await j(r)).error, 'beta_full')
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM users WHERE email='late@x.test'").get() as any).n, 0)
    assert.equal((await signupRaw('manok@x.test', 'man')).status, 200)
    // legacy account with no gender hits the cap on PATCH
    const legacy = await signup('legacy@x.test', 'man')
    db.prepare("UPDATE users SET gender = NULL WHERE email='legacy@x.test'").run()
    const p = await call('PATCH', '/me', legacy.token, { gender: 'woman' })
    assert.equal(p.status, 409)
    assert.equal((await j(p)).error, 'beta_full')
    assert.equal((db.prepare("SELECT gender FROM users WHERE email='legacy@x.test'").get() as any).gender, null)
    await setSettings({ cap_women: 0 })
    assert.equal((await call('PATCH', '/me', legacy.token, { gender: 'man' })).status, 200)
    // the admin account (also a man in the database) does not use up a slot in the men's cap
    const realMen = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE gender='man' AND role != 'admin' AND status != 'deleted'").get() as any).n
    await setSettings({ cap_men: realMen })
    assert.equal((await signupRaw('mancap1@x.test', 'man')).status, 409, 'full when only real members are counted')
    await setSettings({ cap_men: realMen + 1 })
    assert.equal((await signupRaw('mancap2@x.test', 'man')).status, 200, 'one slot left even though the admin is also a man')
    await setSettings({ cap_men: 0 })
    db.close()
  })

  it('beta free credits are granted once and plans expose betaFree', async () => {
    await setSettings({ beta_free: true, beta_free_requests: 4 })
    const m = await signup('free1@x.test', 'man')
    assert.equal((await j(await call('GET', '/me', m.token))).requestCredits, 4)
    const w = await signup('free2@x.test', 'woman')
    assert.equal((await j(await call('GET', '/me', w.token))).requestCredits, 0)
    // legacy man without gender: granted on first set, never twice
    const db = new DatabaseSync(dbPath)
    const legacy = await signup('free3@x.test', 'woman')
    db.prepare("UPDATE users SET gender = NULL WHERE email='free3@x.test'").run()
    assert.equal((await j(await call('PATCH', '/me', legacy.token, { gender: 'man' }))).requestCredits, 4)
    assert.equal((await j(await call('PATCH', '/me', legacy.token, { gender: 'man' }))).requestCredits, 4)
    db.prepare("UPDATE users SET gender = NULL WHERE email='free3@x.test'").run()
    assert.equal((await j(await call('PATCH', '/me', legacy.token, { gender: 'man' }))).requestCredits, 4)
    // plans response (needs an active man)
    db.prepare("UPDATE users SET status='active' WHERE email='free1@x.test'").run()
    assert.equal((await j(await call('GET', '/membership/plans', m.token))).betaFree, true)
    db.close()
    await setSettings({ beta_free: false })
  })

  it('price interest is stored, updatable, validated and shown only on /me', async () => {
    const u = await signup('pi@x.test', 'man')
    assert.equal((await j(await call('GET', '/me', u.token))).priceInterest, null)
    assert.equal((await call('POST', '/me/price-interest', u.token, { answer: 'sure' })).status, 400)
    assert.equal((await call('POST', '/me/price-interest', undefined, { answer: 'yes' })).status, 401)
    assert.equal((await call('POST', '/me/price-interest', u.token, { answer: 'maybe' })).status, 200)
    assert.equal((await call('POST', '/me/price-interest', u.token, { answer: 'yes' })).status, 200)
    assert.equal((await j(await call('GET', '/me', u.token))).priceInterest, 'yes')
    // the question is for men: a woman's answer is refused and never reaches the numbers
    const w = await signup('pi-w@x.test', 'woman')
    const refused = await call('POST', '/me/price-interest', w.token, { answer: 'yes' })
    assert.equal(refused.status, 403)
    assert.equal((await j(refused)).error, 'not_applicable')
    assert.equal((await j(await call('GET', '/me', w.token))).priceInterest, null)
  })

  it('metrics: shape, counts, week-two return, gates; admin only', async () => {
    assert.equal((await call('GET', '/admin/metrics', (await signup('nonadmin@x.test', 'man')).token)).status, 403)
    const m0 = await j(await call('GET', '/admin/metrics', admin.token))
    for (const k of ['members', 'returnedWeek2', 'requests', 'friendsBrought', 'priceInterest', 'caps', 'gates']) assert.ok(k in m0, k)
    assert.equal(m0.friendsBrought, 2) // f1 and f2 came through host's personal code
    assert.equal(m0.priceInterest.yes, 1)
    assert.deepEqual(m0.caps, { women: 0, men: 0 })
    assert.equal(m0.requests.sent, 0)
    assert.equal(m0.requests.acceptanceRate, 0)
    assert.equal(m0.gates.acceptance20, false)
    assert.equal(m0.gates.friends10, false)

    const db = new DatabaseSync(dbPath)
    const id = (email: string) => (db.prepare('SELECT id FROM users WHERE email = ?').get(email) as any).id as string
    db.prepare("UPDATE users SET status='active' WHERE gender='woman'").run()
    const women = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE gender='woman'").get() as any).n
    const men = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE gender='man' AND role != 'admin'").get() as any).n
    const adminMen = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE gender='man' AND role = 'admin'").get() as any).n
    assert.equal(adminMen, 1, 'the admin account is a man in the database, but must not be counted as a member')
    const m1 = await j(await call('GET', '/admin/metrics', admin.token))
    assert.equal(m1.members.women, women)
    assert.equal(m1.members.verifiedWomen, women)
    assert.equal(m1.members.men, men)
    assert.equal(m1.gates.women20, false)

    const mk = (from: string, to: string, status: string) =>
      db.prepare('INSERT INTO requests (id,from_id,to_id,status,created_at) VALUES (?,?,?,?,?)').run(`r-${from}-${to}`, id(from), id(to), status, Date.now())
    mk('f1@x.test', 'w1@x.test', 'accepted')
    mk('f1@x.test', 'host@x.test', 'declined')
    mk('f2@x.test', 'w1@x.test', 'pending')
    mk('f2@x.test', 'host@x.test', 'accepted')
    const m2 = await j(await call('GET', '/admin/metrics', admin.token))
    assert.deepEqual(m2.requests, { sent: 4, accepted: 2, declined: 1, pending: 1, acceptanceRate: 0.5 })
    assert.equal(m2.gates.acceptance20, false) // under 300 requests

    // week-two return: activity 8 days after joining counts, day-one-only does not
    assert.equal(m2.returnedWeek2.women, 0)
    const created = (db.prepare('SELECT created_at FROM users WHERE email = ?').get('w1@x.test') as any).created_at as number
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
    db.prepare('INSERT OR IGNORE INTO user_activity (user_id, day) VALUES (?,?)').run(id('w1@x.test'), day(created + 3 * 86400_000))
    assert.equal((await j(await call('GET', '/admin/metrics', admin.token))).returnedWeek2.women, 0)
    db.prepare('INSERT OR IGNORE INTO user_activity (user_id, day) VALUES (?,?)').run(id('w1@x.test'), day(created + 8 * 86400_000))
    db.prepare('INSERT OR IGNORE INTO user_activity (user_id, day) VALUES (?,?)').run(id('f1@x.test'), day(created + 9 * 86400_000))
    const m3 = await j(await call('GET', '/admin/metrics', admin.token))
    assert.equal(m3.returnedWeek2.women, 1)
    assert.equal(m3.returnedWeek2.men, 1)

    // authed requests record same-day activity automatically (never counted as week two)
    const rows = (db.prepare('SELECT COUNT(*) AS n FROM user_activity WHERE user_id = ?').get(id('host@x.test')) as any).n
    assert.ok(rows >= 1)
    db.close()
  })
})
