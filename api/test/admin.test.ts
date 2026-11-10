import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const PORT = 5150 + Math.floor(Math.random() * 40)
const BASE = `http://127.0.0.1:${PORT}/v0`
const PW = 'Tr0ub4dor&3xKq'
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)])
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)])
let proc: ChildProcess
let dir: string
let admin: string

async function call(method: string, url: string, opts: { token?: string; json?: unknown; form?: FormData } = {}) {
  const headers: Record<string, string> = {}
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  let body: BodyInit | undefined
  if (opts.json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.json) }
  if (opts.form) body = opts.form
  return fetch(BASE + url, { method, headers, body })
}
const j = async (r: Response) => (await r.json()) as any
let n = 0
async function signup(gender: 'man' | 'woman', name = 'T', email = `a${++n}-${Math.random().toString(36).slice(2, 7)}@x.test`) {
  const r = await call('POST', '/signup', { json: { email, password: PW, name, age: 30, gender, agreeToTerms: true } })
  assert.equal(r.status, 200)
  const b = await j(r)
  return { email, token: b.token as string, memberId: b.user.memberId as string }
}
const form = () => {
  const f = new FormData()
  f.set('selfie', new Blob([new Uint8Array(JPEG)], { type: 'image/jpeg' }), 'a.jpg')
  f.set('voice', new Blob([new Uint8Array(WEBM)], { type: 'audio/webm' }), 'v.webm')
  return f
}
const A = (m: string, u: string, json?: unknown) => call(m, u, { token: admin, json })

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'connectly-admin-'))
  proc = spawn(process.execPath, ['src/server.ts'], {
    env: {
      ...process.env, PORT: String(PORT), DB_PATH: path.join(dir, 't.db'), UPLOAD_DIR: path.join(dir, 'up'),
      ADMIN_EMAILS: 'admin@x.test', RATE_LIMIT: 'off', PAYMENT_UPI_ID: 'env@upi', PAYMENT_PAYEE_NAME: 'Env Payee',
    },
    stdio: 'ignore',
  })
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 100))
  }
  admin = (await signup('man', 'Admin', 'admin@x.test')).token
})
after(async () => { proc.kill(); await rm(dir, { recursive: true, force: true }) })

describe('authorization', () => {
  it('every admin endpoint is 403 for members and 401 anonymous', async () => {
    const m = await signup('man')
    const eps: [string, string, unknown?][] = [
      ['GET', '/admin/overview'], ['GET', '/admin/members'], ['GET', `/admin/members/${m.memberId}`],
      ['POST', `/admin/members/${m.memberId}/credits`, { delta: 1, reason: 'x' }], ['GET', '/admin/settings'],
      ['PUT', '/admin/settings', {}],
    ]
    for (const [method, url, json] of eps) {
      assert.equal((await call(method, url, { token: m.token, json })).status, 403, `${method} ${url}`)
      assert.equal((await call(method, url, { json })).status, 401, `${method} ${url} anon`)
    }
  })
})

describe('members', () => {
  it('lists with filters, paging and wildcard-safe search; detail has aliased ids', async () => {
    const a = await signup('woman', 'Zelda_100%')
    const b = await signup('man', 'Zeldax100Z')
    const hit = await j(await A('GET', '/admin/members?q=' + encodeURIComponent('zelda_100%')))
    assert.equal(hit.total, 1)
    assert.equal(hit.items[0].memberId, a.memberId)
    assert.equal(hit.items[0].email, a.email)
    assert.equal((await j(await A('GET', `/admin/members?q=${a.memberId.toLowerCase()}`))).items[0].memberId, a.memberId)
    assert.equal((await j(await A('GET', '/admin/members?q=zeldax'))).items[0].memberId, b.memberId)
    assert.equal((await j(await A('GET', '/admin/members?role=admin'))).items.every((x: any) => x.role === 'admin'), true)
    assert.equal((await j(await A('GET', '/admin/members?gender=woman&limit=1'))).items.length, 1)
    for (const bad of ['limit=101', 'limit=0', 'offset=-1', 'status=bogus', 'gender=x']) {
      assert.equal((await A('GET', '/admin/members?' + bad)).status, 400, bad)
    }
    const d = await j(await A('GET', `/admin/members/${b.memberId}`))
    assert.equal(d.member.memberId, b.memberId)
    assert.equal(d.member.suspended, false)
    assert.deepEqual(d.verifications, [])
    assert.equal((await A('GET', '/admin/members/NOPE0000')).status, 404)
    assert.equal((await A('GET', '/admin/members/bad%20id')).status, 400)
  })

  it('credits: adjusts, never below zero, validated, audited', async () => {
    const m = await signup('man')
    const r = await j(await A('POST', `/admin/members/${m.memberId}/credits`, { delta: 5, reason: 'goodwill' }))
    assert.equal(r.requestCredits, 5)
    assert.equal((await j(await A('POST', `/admin/members/${m.memberId}/credits`, { delta: -2, reason: 'fix' }))).requestCredits, 3)
    const neg = await A('POST', `/admin/members/${m.memberId}/credits`, { delta: -4, reason: 'too much' })
    assert.equal(neg.status, 409)
    assert.equal((await j(neg)).error, 'would_go_negative')
    for (const bad of [{ delta: 0, reason: 'x' }, { delta: 1001, reason: 'x' }, { delta: -1001, reason: 'x' }, { delta: 1.5, reason: 'x' },
      { delta: 1, reason: '' }, { delta: 1, reason: 'x'.repeat(201) }, { delta: 1 }, { delta: '5', reason: 'x' }]) {
      assert.equal((await A('POST', `/admin/members/${m.memberId}/credits`, bad)).status, 400, JSON.stringify(bad))
    }
    assert.equal((await A('POST', '/admin/members/NOPE0000/credits', { delta: 1, reason: 'x' })).status, 404)
    assert.equal((await j(await call('GET', '/me', { token: m.token }))).requestCredits, 3)
    const d = await j(await A('GET', `/admin/members/${m.memberId}`))
    assert.equal(d.audit.length, 2)
    assert.equal(d.audit[0].action, 'credits.adjust')
    assert.equal(d.audit[0].by, 'Admin')
    assert.deepEqual([d.audit[0].detail.delta, d.audit[0].detail.reason], [-2, 'fix'])
  })
})

describe('audit trail and overview', () => {
  it('records verification and payment decisions and feeds overview', async () => {
    const before = await j(await A('GET', '/admin/overview'))
    const m = await signup('man', 'Payer')
    assert.equal((await call('POST', '/verification', { token: m.token, form: form() })).status, 201)
    let ov = await j(await A('GET', '/admin/overview'))
    assert.equal(ov.verificationsPending, before.verificationsPending + 1)
    assert.equal(typeof ov.oldestWaiting.verification, 'number')
    const vs = (await j(await A('GET', '/admin/verifications'))) as any[]
    const v = vs.find((x) => x.user.memberId === m.memberId)
    assert.equal((await A('POST', `/admin/verifications/${v.id}/decision`, { decision: 'approve' })).status, 200)

    const pf = new FormData()
    pf.set('planId', 'pack10')
    pf.set('reference', 'REF' + Math.random().toString(36).slice(2, 10).toUpperCase())
    pf.set('proof', new Blob([new Uint8Array(JPEG)], { type: 'image/jpeg' }), 'p.jpg')
    assert.equal((await call('POST', '/payments', { token: m.token, form: pf })).status, 201)
    const ps = (await j(await A('GET', '/admin/payments'))) as any[]
    const p = ps.find((x) => x.user.memberId === m.memberId)
    assert.equal((await A('POST', `/admin/payments/${p.id}/decision`, { decision: 'approve' })).status, 200)

    const d = await j(await A('GET', `/admin/members/${m.memberId}`))
    assert.deepEqual(d.audit.map((a: any) => a.action).sort(), ['payment.approve', 'verification.approve'])
    assert.equal(d.verifications[0].status, 'approved')
    assert.equal(d.payments[0].requests, 10)
    assert.equal(d.member.requestCredits, 10)
    ov = await j(await A('GET', '/admin/overview'))
    assert.equal(ov.recent.length <= 8, true)
    assert.equal(ov.recent[0].by, 'Admin')
    assert.equal(ov.recent[0].member.memberId, m.memberId)
  })
})

describe('settings', () => {
  it('GET defaults, PUT validates, and new prices apply to new purchases only', async () => {
    const s = await j(await A('GET', '/admin/settings'))
    assert.deepEqual(s.packs, [{ id: 'pack10', requests: 10, amountPaise: 49900 }, { id: 'pack20', requests: 20, amountPaise: 89900 }])
    assert.deepEqual(s.payee, { name: 'Env Payee', upiId: 'env@upi' })
    assert.deepEqual(s.quickReasons, { verification: [], payment: [] })

    const good = {
      packs: [{ id: 'pack20', requests: 25, amountPaise: 99900 }, { id: 'pack10', requests: 12, amountPaise: 59900 }],
      payee: { name: 'Club', upiId: 'club@upi' },
      quickReasons: { verification: ['Blurry selfie'], payment: ['Amount mismatch'] },
    }
    const badCases = [
      { ...good, packs: [good.packs[0]] },
      { ...good, packs: [good.packs[0], good.packs[0]] },
      { ...good, packs: [{ id: 'pack10', requests: 0, amountPaise: 500 }, good.packs[0]] },
      { ...good, packs: [{ id: 'pack10', requests: 501, amountPaise: 500 }, good.packs[0]] },
      { ...good, packs: [{ id: 'pack10', requests: 5, amountPaise: 99 }, good.packs[0]] },
      { ...good, packs: [{ id: 'pack10', requests: 5, amountPaise: 10_000_001 }, good.packs[0]] },
      { ...good, packs: [{ id: 'pack99', requests: 5, amountPaise: 500 }, good.packs[0]] },
      { ...good, quickReasons: { verification: Array(9).fill('x'), payment: [] } },
      { ...good, quickReasons: { verification: ['x'.repeat(81)], payment: [] } },
      { ...good, payee: { name: 'x'.repeat(101), upiId: null } },
    ]
    for (const [i, bad] of badCases.entries()) assert.equal((await A('PUT', '/admin/settings', bad)).status, 400, `bad case ${i}`)

    // A payment made at the old price keeps its snapshot after the change.
    const m = await signup('man')
    await call('POST', '/verification', { token: m.token, form: form() })
    const vs = (await j(await A('GET', '/admin/verifications'))) as any[]
    await A('POST', `/admin/verifications/${vs.find((x) => x.user.memberId === m.memberId).id}/decision`, { decision: 'approve' })
    const pf = new FormData()
    pf.set('planId', 'pack10')
    pf.set('reference', 'SNAP' + Math.random().toString(36).slice(2, 10).toUpperCase())
    pf.set('proof', new Blob([new Uint8Array(JPEG), Buffer.from('snap')], { type: 'image/jpeg' }), 'p.jpg')
    assert.equal((await call('POST', '/payments', { token: m.token, form: pf })).status, 201)

    const put = await A('PUT', '/admin/settings', good)
    assert.equal(put.status, 200)
    const saved = await j(put)
    assert.deepEqual(saved.packs.map((p: any) => p.id), ['pack10', 'pack20'])
    assert.deepEqual(saved.payee, { name: 'Club', upiId: 'club@upi' })

    const plans = await j(await call('GET', '/membership/plans', { token: m.token }))
    assert.deepEqual(plans.plans.map((p: any) => [p.id, p.requests, p.amountPaise]), [['pack10', 12, 59900], ['pack20', 25, 99900]])
    assert.equal(plans.payment.upiId, 'club@upi')
    const mine = await j(await call('GET', '/payments/mine', { token: m.token }))
    assert.equal(mine[0].amountPaise, 49900)
    assert.equal(mine[0].requests, 10)
    // Settings changes are audited (no target member).
    assert.equal((await j(await A('GET', '/admin/settings'))).quickReasons.payment[0], 'Amount mismatch')
  })
})
