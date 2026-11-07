import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const PORT = 4300 + Math.floor(Math.random() * 100)
const BASE = `http://127.0.0.1:${PORT}/v0`
let proc: ChildProcess
let dir: string

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)])
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)])

type Account = { token: string; bumpId: string }

async function call(method: string, url: string, opts: { token?: string; json?: unknown; form?: FormData } = {}) {
  const headers: Record<string, string> = {}
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  let body: BodyInit | undefined
  if (opts.json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.json) }
  if (opts.form) body = opts.form
  return fetch(BASE + url, { method, headers, body })
}
const json = async (r: Response) => (await r.json()) as any

async function signup(email: string, name: string): Promise<Account> {
  const r = await call('POST', '/signup', { json: { email, password: 'Tr0ub4dor&3xKq', name, age: 30 } })
  assert.equal(r.status, 200)
  const b = await json(r)
  return { token: b.token, bumpId: b.user.bumpId }
}

let adminToken = ''
let admin2: Account

async function activeUser(email: string, name: string): Promise<Account> {
  const u = await signup(email, name)
  const f = new FormData()
  f.set('selfie', new Blob([new Uint8Array(JPEG)], { type: 'image/jpeg' }), 'me.jpg')
  f.set('voice', new Blob([new Uint8Array(WEBM)], { type: 'audio/webm' }), 'v.webm')
  assert.equal((await call('POST', '/verification', { token: u.token, form: f })).status, 201)
  const list = await json(await call('GET', '/admin/verifications', { token: adminToken }))
  const item = list.find((x: any) => x.user.bumpId === u.bumpId)
  assert.equal((await call('POST', `/admin/verifications/${item.id}/decision`, { token: adminToken, json: { decision: 'approve' } })).status, 200)
  return u
}

const wallNames = async (u: Account) => (await json(await call('GET', '/profiles', { token: u.token }))).map((p: any) => p.name) as string[]
const connNames = async (u: Account) => (await json(await call('GET', '/connections', { token: u.token }))).map((c: any) => c.profile.name) as string[]
const block = (u: Account, target: Account) => call('POST', '/blocks', { token: u.token, json: { bumpId: target.bumpId } })
const report = (u: Account, target: Account | string, reason = 'spam', details?: string) =>
  call('POST', '/reports', { token: u.token, json: { bumpId: typeof target === 'string' ? target : target.bumpId, reason, details } })

async function match(a: Account, b: Account) {
  await call('POST', '/actions', { token: a.token, json: { bumpId: b.bumpId, action: 'like' } })
  const r = await json(await call('POST', '/actions', { token: b.token, json: { bumpId: a.bumpId, action: 'like' } }))
  assert.equal(r.matched, true)
  return r.connectionId as string
}

async function openReports(status = 'open') {
  return (await json(await call('GET', `/admin/reports?status=${status}`, { token: adminToken }))) as any[]
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'connectly-safety-'))
  proc = spawn(process.execPath, ['src/server.ts'], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(dir, 't.db'), UPLOAD_DIR: path.join(dir, 'up'), ADMIN_EMAILS: 'admin@x.test,admin2@x.test' },
    stdio: 'ignore',
  })
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100))
  }
  adminToken = (await signup('admin@x.test', 'Admin')).token
  admin2 = await signup('admin2@x.test', 'Admin2') // admins are exempt from the membership rule, so they can chat
})

after(async () => {
  proc.kill()
  await rm(dir, { recursive: true, force: true })
})

describe('blocks', () => {
  it('require an active member', async () => {
    const un = await signup('unv@x.test', 'Unv')
    const target = await activeUser('t0@x.test', 'T0')
    for (const [m, u, j] of [['POST', '/blocks', { bumpId: target.bumpId }], ['GET', '/blocks', undefined], ['DELETE', `/blocks/${target.bumpId}`, undefined]] as const) {
      const r = await call(m, u, { token: un.token, json: j })
      assert.equal(r.status, 403, `${m} ${u}`)
    }
    assert.equal((await call('POST', '/blocks', { json: { bumpId: target.bumpId } })).status, 401)
  })

  it('block and unblock are idempotent; list is newest first', async () => {
    const me = await activeUser('b1@x.test', 'Me1')
    const x = await activeUser('b2@x.test', 'Xena')
    const y = await activeUser('b3@x.test', 'Yuri')
    assert.equal((await block(me, x)).status, 200)
    assert.equal((await block(me, x)).status, 200, 'second block is a no-op')
    await new Promise((r) => setTimeout(r, 5))
    assert.equal((await block(me, y)).status, 200)
    const list = await json(await call('GET', '/blocks', { token: me.token }))
    assert.deepEqual(list.map((b: any) => b.name), ['Yuri', 'Xena'])
    assert.deepEqual(Object.keys(list[0]).sort(), ['age', 'bumpId', 'name'])
    assert.equal((await call('DELETE', `/blocks/${x.bumpId}`, { token: me.token })).status, 200)
    assert.equal((await call('DELETE', `/blocks/${x.bumpId}`, { token: me.token })).status, 200, 'second unblock is a no-op')
    assert.deepEqual((await json(await call('GET', '/blocks', { token: me.token }))).map((b: any) => b.name), ['Yuri'])
    // the blocked party sees nothing about it
    assert.deepEqual(await json(await call('GET', '/blocks', { token: y.token })), [])
  })

  it('rejects self, unknown, unverified targets and bad input', async () => {
    const me = await activeUser('b4@x.test', 'Me4')
    const un = await signup('b5@x.test', 'Unverified')
    assert.equal((await block(me, me)).status, 400)
    assert.equal((await call('POST', '/blocks', { token: me.token, json: { bumpId: 'NOSUCH00' } })).status, 404)
    assert.equal((await block(me, un)).status, 404)
    assert.equal((await call('POST', '/blocks', { token: me.token, json: {} })).status, 400)
    assert.deepEqual(await json(await call('GET', '/blocks', { token: me.token })), [])
  })

  it('hide members from the wall and connections in both directions', async () => {
    const a = await activeUser('h1@x.test', 'HideA')
    const b = await activeUser('h2@x.test', 'HideB')
    const c = await activeUser('h3@x.test', 'HideC')
    await match(a, b)
    assert.ok((await connNames(a)).includes('HideB'))
    assert.ok((await wallNames(a)).includes('HideC'))

    assert.equal((await block(a, b)).status, 200)
    assert.ok(!(await connNames(a)).includes('HideB'), 'blocker no longer sees the connection')
    assert.ok(!(await connNames(b)).includes('HideA'), 'blocked member no longer sees the connection')
    assert.ok(!(await wallNames(b)).includes('HideA'), 'blocked member cannot see the blocker on the wall')
    assert.ok((await wallNames(c)).includes('HideA'), 'others are unaffected')

    assert.equal((await block(c, a)).status, 200)
    assert.ok(!(await wallNames(a)).includes('HideC'), 'blocker does not see blocked on the wall')
    assert.ok(!(await wallNames(c)).includes('HideA'))

    // unblocking restores visibility
    assert.equal((await call('DELETE', `/blocks/${b.bumpId}`, { token: a.token })).status, 200)
    assert.ok((await connNames(a)).includes('HideB'))
    assert.ok((await connNames(b)).includes('HideA'))
  })

  it('refuse like/skip in either direction without revealing the block', async () => {
    const a = await activeUser('l1@x.test', 'LikeA')
    const b = await activeUser('l2@x.test', 'LikeB')
    const ghost = await call('POST', '/actions', { token: a.token, json: { bumpId: 'NOSUCH00', action: 'like' } })
    assert.equal(ghost.status, 404)
    assert.equal((await block(a, b)).status, 200)
    for (const [from, to] of [[a, b], [b, a]] as const) {
      for (const action of ['like', 'skip']) {
        const r = await call('POST', '/actions', { token: from.token, json: { bumpId: to.bumpId, action } })
        assert.equal(r.status, 404, `${action}`)
        assert.deepEqual(await json(r), { error: 'not_found' }, 'same body as an unknown member')
      }
    }
  })

  it('refuse messages in either direction but keep history readable', async () => {
    const m = await activeUser('m1@x.test', 'MsgMember')
    const conn = await match(admin2, m)
    const send = (u: Account) => call('POST', `/connections/${conn}/messages`, { token: u.token, json: { body: 'hello' } })
    assert.equal((await send(admin2)).status, 200)

    assert.equal((await block(m, admin2)).status, 200)
    let r = await send(admin2)
    assert.equal(r.status, 403)
    assert.equal((await json(r)).error, 'blocked')
    assert.equal((await call('GET', `/connections/${conn}/messages`, { token: admin2.token })).status, 200)
    const history = await json(await call('GET', `/connections/${conn}/messages`, { token: m.token }))
    assert.equal(history.length, 1, 'existing history stays readable')

    // the other direction: admin2 blocks the member, then unblocking restores sending
    assert.equal((await call('DELETE', `/blocks/${admin2.bumpId}`, { token: m.token })).status, 200)
    assert.equal((await send(admin2)).status, 200)
    assert.equal((await block(admin2, m)).status, 200)
    r = await send(admin2)
    assert.equal((await json(r)).error, 'blocked')
  })
})

describe('reports', () => {
  it('validate input and targets', async () => {
    const me = await activeUser('r1@x.test', 'Rep1')
    const t = await activeUser('r2@x.test', 'Tgt2')
    const un = await signup('r3@x.test', 'Unv3')
    assert.equal((await report(me, me)).status, 400, 'self')
    assert.equal((await report(me, 'NOSUCH00')).status, 404)
    assert.equal((await report(me, un)).status, 404, 'unverified target')
    assert.equal((await report(me, t, 'rude')).status, 400, 'unknown reason')
    assert.equal((await report(me, t, 'other', 'x'.repeat(501))).status, 400, 'details too long')
    assert.equal((await call('POST', '/reports', { token: me.token, json: { bumpId: t.bumpId } })).status, 400, 'missing reason')
    assert.equal((await call('POST', '/reports', { json: { bumpId: t.bumpId, reason: 'spam' } })).status, 401)
    assert.equal((await call('POST', '/reports', { token: un.token, json: { bumpId: t.bumpId, reason: 'spam' } })).status, 403)
    assert.equal((await report(me, t, 'other', 'x'.repeat(500))).status, 201, 'exactly 500 is fine')
  })

  it('allow one open report per pair and release it after a decision', async () => {
    const me = await activeUser('d1@x.test', 'Dup1')
    const t = await activeUser('d2@x.test', 'Dup2')
    assert.equal((await report(me, t, 'spam')).status, 201)
    const r = await report(me, t, 'harassment')
    assert.equal(r.status, 409)
    assert.equal((await json(r)).error, 'already_reported')

    const item = (await openReports()).find((x) => x.reported.bumpId === t.bumpId)
    assert.equal((await call('POST', `/admin/reports/${item.report.id}/decision`, { token: adminToken, json: { decision: 'dismiss' } })).status, 200)
    assert.equal((await report(me, t, 'harassment')).status, 201, 'can report again once the first is decided')
  })

  it('rate limit to 10 per reporter per day', async () => {
    const me = await activeUser('q0@x.test', 'Rate0')
    for (let i = 1; i <= 10; i++) {
      const t = await activeUser(`q${i}@x.test`, `Rate${i}`)
      assert.equal((await report(me, t)).status, 201, `report ${i}`)
    }
    const extra = await activeUser('q11@x.test', 'Rate11')
    const r = await report(me, extra)
    assert.equal(r.status, 429)
    assert.equal((await json(r)).error, 'rate_limited')
  })

  it('never reveal the reporter to the reported member', async () => {
    const rep = await activeUser('a1@x.test', 'Secret Reporter')
    const t = await activeUser('a2@x.test', 'Reported')
    const created = await report(rep, t, 'harassment', 'private details')
    assert.deepEqual(await json(created), { ok: true })
    // the reported member's own data holds no trace of the report (the wall may list the reporter as any other member)
    const surfaces = ['/me', '/connections', '/blocks']
    for (const s of surfaces) {
      const text = await (await call('GET', s, { token: t.token })).text()
      assert.ok(!text.includes(rep.bumpId) && !text.includes('private details') && !text.includes('report'), s)
    }
    for (const s of ['/admin/reports', '/admin/reports/x/decision']) {
      assert.equal((await call(s.endsWith('decision') ? 'POST' : 'GET', s, { token: t.token, json: s.endsWith('decision') ? {} : undefined })).status, 403, s)
    }
  })
})

describe('admin review', () => {
  it('is restricted to admins', async () => {
    const u = await activeUser('z1@x.test', 'Plain')
    assert.equal((await call('GET', '/admin/reports', { token: u.token })).status, 403)
    assert.equal((await call('POST', `/admin/reports/${crypto.randomUUID()}/decision`, { token: u.token, json: { decision: 'dismiss' } })).status, 403)
    assert.equal((await call('POST', `/admin/suspensions/${u.bumpId}/lift`, { token: u.token })).status, 403)
    assert.equal((await call('GET', '/admin/reports')).status, 401)
  })

  it('lists reports with context and validates the status filter', async () => {
    const rep = await activeUser('y1@x.test', 'Lister')
    const t = await activeUser('y2@x.test', 'Listed')
    const other = await activeUser('y3@x.test', 'Lister2')
    await report(rep, t, 'fake_profile', 'looks stolen')
    await report(other, t, 'underage')
    const items = (await openReports()).filter((x) => x.reported.bumpId === t.bumpId)
    assert.equal(items.length, 2)
    const first = items.find((x) => x.reporter.bumpId === rep.bumpId)
    assert.equal(first.report.reason, 'fake_profile')
    assert.equal(first.report.details, 'looks stolen')
    assert.equal(first.report.status, 'open')
    assert.deepEqual(first.reporter, { bumpId: rep.bumpId, name: 'Lister' })
    assert.equal(first.reported.name, 'Listed')
    assert.equal(first.reported.email, 'y2@x.test')
    assert.equal(first.reported.suspended, false)
    assert.equal(first.reported.openReportCount, 2)
    assert.equal((await call('GET', '/admin/reports?status=bogus', { token: adminToken })).status, 400)
    assert.deepEqual((await openReports('actioned')).filter((x) => x.reported.bumpId === t.bumpId), [])
  })

  it('decision validation, dismissal and race safety', async () => {
    const rep = await activeUser('w1@x.test', 'Dec1')
    const t = await activeUser('w2@x.test', 'Dec2')
    await report(rep, t)
    const id = (await openReports()).find((x) => x.reported.bumpId === t.bumpId).report.id
    const decide = (j: unknown) => call('POST', `/admin/reports/${id}/decision`, { token: adminToken, json: j })

    assert.equal((await decide({ decision: 'action', suspend: false })).status, 400, 'note required for action')
    assert.equal((await decide({ decision: 'action', note: '  ', suspend: false })).status, 400, 'blank note')
    assert.equal((await decide({ decision: 'action', note: 'x' })).status, 400, 'suspend required')
    assert.equal((await decide({ decision: 'maybe' })).status, 400)
    assert.equal((await call('POST', '/admin/reports/not-a-uuid/decision', { token: adminToken, json: { decision: 'dismiss' } })).status, 400)
    assert.equal((await call('POST', `/admin/reports/${crypto.randomUUID()}/decision`, { token: adminToken, json: { decision: 'dismiss' } })).status, 404)

    const results = await Promise.all([decide({ decision: 'dismiss', note: 'no issue' }), decide({ decision: 'action', note: 'bad', suspend: true })])
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409])
    const final = (await openReports('dismissed')).concat(await openReports('actioned')).find((x) => x.report.id === id)
    assert.ok(final)
    // only the winner's effect applies: a suspension exists iff the report was actioned
    assert.equal(final.reported.suspended, final.report.status === 'actioned')
    assert.equal((await decide({ decision: 'dismiss' })).status, 409)
  })

  it('action with suspension makes the member invisible and inert, and lifting restores them', async () => {
    const rep = await activeUser('s1@x.test', 'Reporter')
    const bad = await activeUser('s2@x.test', 'BadActor')
    const friend = await activeUser('s3@x.test', 'Friend')
    const conn = await match(bad, friend)
    assert.ok((await wallNames(rep)).includes('BadActor'))

    await report(rep, bad, 'harassment')
    const id = (await openReports()).find((x) => x.reported.bumpId === bad.bumpId).report.id
    const r = await call('POST', `/admin/reports/${id}/decision`, { token: adminToken, json: { decision: 'action', note: 'Confirmed harassment', suspend: true } })
    assert.equal(r.status, 200)

    const done = (await openReports('actioned')).find((x) => x.report.id === id)
    assert.equal(done.report.note, 'Confirmed harassment')
    assert.ok(done.report.reviewedAt)
    assert.equal(done.reported.suspended, true)
    assert.equal(done.reported.openReportCount, 0)

    assert.ok(!(await wallNames(rep)).includes('BadActor'), 'hidden from the wall')
    // still logged in and able to read their own data
    assert.equal((await call('GET', '/me', { token: bad.token })).status, 200)
    assert.equal((await call('GET', `/connections/${conn}/messages`, { token: bad.token })).status, 200)
    // inert: cannot like, and nobody can like them
    const act = await call('POST', '/actions', { token: bad.token, json: { bumpId: rep.bumpId, action: 'like' } })
    assert.equal(act.status, 403)
    assert.equal((await json(act)).error, 'suspended')
    assert.equal((await call('POST', '/actions', { token: rep.token, json: { bumpId: bad.bumpId, action: 'like' } })).status, 404)

    assert.equal((await call('POST', `/admin/suspensions/${bad.bumpId}/lift`, { token: adminToken })).status, 200)
    assert.equal((await call('POST', `/admin/suspensions/${bad.bumpId}/lift`, { token: adminToken })).status, 404, 'nothing left to lift')
    assert.ok((await wallNames(rep)).includes('BadActor'), 'visible again')
    assert.equal((await call('POST', '/actions', { token: bad.token, json: { bumpId: rep.bumpId, action: 'like' } })).status, 200)
  })

  it('a suspended member cannot send messages', async () => {
    const rep = await activeUser('k1@x.test', 'Rep')
    const sender = admin2
    const peer = await activeUser('k2@x.test', 'Peer')
    const conn = await match(sender, peer)
    await report(rep, sender, 'spam')
    const id = (await openReports()).find((x) => x.reported.bumpId === sender.bumpId).report.id
    await call('POST', `/admin/reports/${id}/decision`, { token: adminToken, json: { decision: 'action', note: 'spam', suspend: true } })
    const r = await call('POST', `/connections/${conn}/messages`, { token: sender.token, json: { body: 'hi' } })
    assert.equal(r.status, 403)
    assert.equal((await json(r)).error, 'suspended')
    await call('POST', `/admin/suspensions/${sender.bumpId}/lift`, { token: adminToken })
    assert.equal((await call('POST', `/connections/${conn}/messages`, { token: sender.token, json: { body: 'hi' } })).status, 200)
  })

  it('action without suspension leaves the member active', async () => {
    const rep = await activeUser('n1@x.test', 'NRep')
    const t = await activeUser('n2@x.test', 'NTgt')
    await report(rep, t)
    const id = (await openReports()).find((x) => x.reported.bumpId === t.bumpId).report.id
    assert.equal((await call('POST', `/admin/reports/${id}/decision`, { token: adminToken, json: { decision: 'action', note: 'warned', suspend: false } })).status, 200)
    assert.ok((await wallNames(rep)).includes('NTgt'))
    assert.equal((await openReports('actioned')).find((x) => x.report.id === id).reported.suspended, false)
  })
})
