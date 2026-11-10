import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const PORT = 5190 + Math.floor(Math.random() * 40)
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
const A = (m: string, u: string, json?: unknown) => call(m, u, { token: admin, json })

let n = 0
async function signup(gender: 'man' | 'woman', name = 'T', email = `r${++n}-${Math.random().toString(36).slice(2, 7)}@x.test`) {
  const r = await call('POST', '/signup', { json: { email, password: PW, name, age: 30, gender, agreeToTerms: true } })
  assert.equal(r.status, 200)
  const b = await j(r)
  return { email, token: b.token as string, memberId: b.user.memberId as string }
}

/** A verified (active) man, ready to buy. */
async function verifiedMan(name = 'Payer') {
  const m = await signup('man', name)
  const f = new FormData()
  f.set('selfie', new Blob([new Uint8Array(JPEG)], { type: 'image/jpeg' }), 'a.jpg')
  f.set('voice', new Blob([new Uint8Array(WEBM)], { type: 'audio/webm' }), 'v.webm')
  assert.equal((await call('POST', '/verification', { token: m.token, form: f })).status, 201)
  const v = ((await j(await A('GET', '/admin/verifications'))) as any[]).find((x) => x.user.memberId === m.memberId)
  assert.equal((await A('POST', `/admin/verifications/${v.id}/decision`, { decision: 'approve' })).status, 200)
  return m
}

/** Uploads a payment (each with its own reference and proof) and returns the response. */
function pay(m: { token: string }, planId = 'pack10') {
  const f = new FormData()
  f.set('planId', planId)
  f.set('reference', 'REF' + randomBytes(5).toString('hex').toUpperCase())
  f.set('proof', new Blob([new Uint8Array(Buffer.concat([JPEG, randomBytes(24)]))], { type: 'image/jpeg' }), 'p.jpg')
  return call('POST', '/payments', { token: m.token, form: f })
}
const paymentOf = async (m: { memberId: string }, status: 'pending' | 'approved' | 'rejected') =>
  ((await j(await A('GET', `/admin/payments?status=${status}`))) as any[]).find((x) => x.user.memberId === m.memberId)
async function buyAndApprove(m: { token: string; memberId: string }, planId = 'pack10') {
  assert.equal((await pay(m, planId)).status, 201)
  const p = await paymentOf(m, 'pending')
  assert.equal((await A('POST', `/admin/payments/${p.id}/decision`, { decision: 'approve' })).status, 200)
  return p.id as string
}
const balance = async (m: { memberId: string }) => (await j(await A('GET', `/admin/members/${m.memberId}`))).member.requestCredits as number
const setSettings = async (patch: Record<string, unknown>) => {
  const cur = await j(await A('GET', '/admin/settings'))
  const r = await A('PUT', '/admin/settings', { packs: cur.packs, payee: cur.payee, quickReasons: cur.quickReasons, ...patch })
  assert.equal(r.status, 200)
  return j(r)
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'connectly-refund-'))
  proc = spawn(process.execPath, ['src/server.ts'], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(dir, 't.db'), UPLOAD_DIR: path.join(dir, 'up'), ADMIN_EMAILS: 'admin@x.test', RATE_LIMIT: 'off' },
    stdio: 'ignore',
  })
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 100))
  }
  admin = (await signup('man', 'Admin', 'admin@x.test')).token
})
after(async () => { proc.kill(); await rm(dir, { recursive: true, force: true }) })

describe('refunds', () => {
  it('suggests a fair refund for unused requests, records it, and takes the requests off the balance', async () => {
    const m = await verifiedMan()
    const id = await buyAndApprove(m)
    assert.equal(await balance(m), 10)
    // he uses 4 requests
    assert.equal((await A('POST', `/admin/members/${m.memberId}/credits`, { delta: -4, reason: 'used' })).status, 200)

    const item = await paymentOf(m, 'approved')
    assert.deepEqual({ ...item.refund }, {
      refundedPaise: 0, refundedRequests: 0, remainingPaise: 49900, remainingRequests: 10, balance: 6,
      suggestedPaise: 29940, suggestedRequests: 6, // 6 unused requests at 49,900 / 10 each
    })
    const r = await A('POST', `/admin/payments/${id}/refund`, { amountPaise: 29940, requests: 6, note: 'Asked for a refund, six unused' })
    assert.equal(r.status, 200)
    assert.deepEqual(await j(r), { ok: true, refundedPaise: 29940, refundedRequests: 6, remainingPaise: 19960, remainingRequests: 4 })
    assert.equal(await balance(m), 0)

    // the member sees it
    const mine = (await j(await call('GET', '/payments/mine', { token: m.token })))[0]
    assert.equal(mine.refundedPaise, 29940)
    assert.equal(mine.refundedRequests, 6)
    // and it is audited
    const d = await j(await A('GET', `/admin/members/${m.memberId}`))
    assert.ok(d.audit.some((a: any) => a.action === 'payment.refund'))
  })

  it('refuses more than was paid, more requests than the member has, and non-approved payments', async () => {
    const m = await verifiedMan()
    const id = await buyAndApprove(m)
    const ok = { amountPaise: 1000, requests: 1, note: 'check' }
    const tooMuch = await A('POST', `/admin/payments/${id}/refund`, { ...ok, amountPaise: 49901 })
    assert.equal(tooMuch.status, 409); assert.equal((await j(tooMuch)).error, 'too_much')
    const tooMany = await A('POST', `/admin/payments/${id}/refund`, { ...ok, requests: 11 })
    assert.equal(tooMany.status, 409); assert.equal((await j(tooMany)).error, 'too_many_requests')
    // he has only 3 left, so he cannot be refunded for 4
    assert.equal((await A('POST', `/admin/members/${m.memberId}/credits`, { delta: -7, reason: 'used' })).status, 200)
    assert.equal((await j(await A('POST', `/admin/payments/${id}/refund`, { ...ok, requests: 4 }))).error, 'too_many_requests')
    assert.equal(await balance(m), 3, 'a refused refund changes nothing')
    assert.equal((await A('POST', `/admin/payments/${id}/refund`, { ...ok, requests: 3 })).status, 200)
    // a refund of money only, with no requests taken back, is allowed (goodwill)
    assert.equal((await A('POST', `/admin/payments/${id}/refund`, { amountPaise: 500, requests: 0, note: 'goodwill' })).status, 200)

    // a payment still waiting for review, or a rejected one, cannot be refunded
    const w = await verifiedMan('Waiting')
    assert.equal((await pay(w)).status, 201)
    const pending = await paymentOf(w, 'pending')
    const np = await A('POST', `/admin/payments/${pending.id}/refund`, ok)
    assert.equal(np.status, 409); assert.equal((await j(np)).error, 'not_approved')
    assert.equal((await A('POST', `/admin/payments/${pending.id}/decision`, { decision: 'reject', reason: 'blurry' })).status, 200)
    assert.equal((await j(await A('POST', `/admin/payments/${pending.id}/refund`, ok))).error, 'not_approved')
  })

  it('validates input and is admin only', async () => {
    const m = await verifiedMan()
    const id = await buyAndApprove(m)
    for (const bad of [{}, { amountPaise: 0, requests: 0, note: 'x' }, { amountPaise: 100, requests: -1, note: 'x' }, { amountPaise: 1.5, requests: 0, note: 'x' },
      { amountPaise: 100, requests: 0, note: '' }, { amountPaise: 100, requests: 0, note: '   ' }, { amountPaise: 100, requests: 0, note: 'x'.repeat(301) }]) {
      assert.equal((await A('POST', `/admin/payments/${id}/refund`, bad)).status, 400, JSON.stringify(bad))
    }
    assert.equal((await A('POST', '/admin/payments/not-a-uuid/refund', { amountPaise: 100, requests: 0, note: 'x' })).status, 400)
    assert.equal((await A('POST', '/admin/payments/00000000-0000-4000-8000-000000000000/refund', { amountPaise: 100, requests: 0, note: 'x' })).status, 404)
    assert.equal((await call('POST', `/admin/payments/${id}/refund`, { json: { amountPaise: 100, requests: 0, note: 'x' } })).status, 401)
    assert.equal((await call('POST', `/admin/payments/${id}/refund`, { token: m.token, json: { amountPaise: 100, requests: 0, note: 'x' } })).status, 403)
    assert.equal(await balance(m), 10, 'nothing changed')
  })

  it('a refund frees up room under the sales cap', async () => {
    await setSettings({ payCapRupees: 0, payCapMen: 0 })
    const h0 = await j(await A('GET', '/admin/health'))
    const base = h0.money.revenuePaise as number
    const m = await verifiedMan()
    const id = await buyAndApprove(m)
    const h1 = await j(await A('GET', '/admin/health'))
    assert.equal(h1.money.revenuePaise, base + 49900)
    assert.equal((await A('POST', `/admin/payments/${id}/refund`, { amountPaise: 49900, requests: 10, note: 'full refund' })).status, 200)
    const h2 = await j(await A('GET', '/admin/health'))
    assert.equal(h2.money.revenuePaise, base, 'net sales fall by the refund')
    assert.ok(h2.money.refundedPaise >= 49900)
    assert.equal(h2.money.capPaise, null)
    assert.equal(h2.money.capMen, null)
  })
})

describe('pack sales cap', () => {
  it('stops new paying men once the limit is reached, but lets existing payers top up', async () => {
    await setSettings({ payCapRupees: 0, payCapMen: 0 })
    const paying = ((await j(await A('GET', '/admin/health'))).money.paidMen as number)
    const a = await verifiedMan('CapA')
    const b = await verifiedMan('CapB')
    // allow exactly one more paying man than there are now
    const s = await setSettings({ payCapMen: paying + 1 })
    assert.equal(s.payCapMen, paying + 1)
    assert.equal((await pay(a)).status, 201)
    // b is a new payer and the limit is now used up (a's payment counts while it waits for review)
    const closed = await pay(b)
    assert.equal(closed.status, 409)
    assert.equal((await j(closed)).error, 'payments_closed')
    assert.equal((await j(await call('GET', '/membership/plans', { token: b.token }))).closed, 'men')
    assert.equal((await j(await call('GET', '/membership/plans', { token: a.token }))).closed, null, 'an existing payer is not shut out')
    const alerts = (await j(await A('GET', '/admin/health'))).alerts as any[]
    assert.ok(alerts.some((x) => x.key === 'pay_cap'))
    // the rejected attempt left nothing behind
    assert.equal(await paymentOf(b, 'pending'), undefined)

    // a, once approved, can buy again because he is already a paying man
    const p = await paymentOf(a, 'pending')
    assert.equal((await A('POST', `/admin/payments/${p.id}/decision`, { decision: 'approve' })).status, 200)
    assert.equal((await pay(a)).status, 201)

    await setSettings({ payCapMen: 0 })
    assert.equal((await pay(b)).status, 201, 'sales reopen when the limit is lifted')
  })

  it('stops sales once the total reaches the rupee limit, counting payments still waiting for review', async () => {
    await setSettings({ payCapMen: 0, payCapRupees: 0 })
    const committed = ((await j(await A('GET', '/admin/health'))).money.revenuePaise as number)
    const pendingNow = ((await j(await A('GET', '/admin/payments?status=pending'))) as any[]).reduce((s, x) => s + x.amountPaise, 0)
    const m = await verifiedMan('Rev')
    // room for exactly one more pack10 (499 rupees) beyond what is committed now
    const capRupees = Math.ceil((committed + pendingNow + 49900) / 100)
    const s = await setSettings({ payCapRupees: capRupees })
    assert.equal(s.payCapRupees, capRupees)
    assert.equal((await pay(m)).status, 201)
    const p = await paymentOf(m, 'pending')
    // it is now full: a second man cannot buy, and the plans say why
    const o = await verifiedMan('Rev2')
    assert.equal((await j(await call('GET', '/membership/plans', { token: o.token }))).closed, 'revenue')
    const r = await pay(o)
    assert.equal(r.status, 409)
    assert.equal((await j(r)).error, 'payments_closed')
    // rejecting the waiting payment frees the room again
    assert.equal((await A('POST', `/admin/payments/${p.id}/decision`, { decision: 'reject', reason: 'blurry' })).status, 200)
    assert.equal((await pay(o)).status, 201)
    const money = (await j(await A('GET', '/admin/health'))).money
    assert.equal(money.capPaise, capRupees * 100)
    await setSettings({ payCapRupees: 0 })
  })

  it('the cap settings validate and default to no limit', async () => {
    const cur = await j(await A('GET', '/admin/settings'))
    assert.equal(typeof cur.payCapMen, 'number')
    assert.equal(typeof cur.payCapRupees, 'number')
    for (const bad of [{ payCapMen: -1 }, { payCapRupees: -5 }, { payCapMen: 1.5 }, { payCapRupees: 'ten' }]) {
      const r = await A('PUT', '/admin/settings', { packs: cur.packs, payee: cur.payee, quickReasons: cur.quickReasons, ...bad })
      assert.equal(r.status, 400, JSON.stringify(bad))
    }
  })
})
