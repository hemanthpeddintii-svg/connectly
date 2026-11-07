import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const PORT = 4100 + Math.floor(Math.random() * 800)
const BASE = `http://127.0.0.1:${PORT}/v0`
let proc: ChildProcess
let dir: string

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)])
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)])

async function call(method: string, url: string, opts: { token?: string; json?: unknown; form?: FormData } = {}) {
  const headers: Record<string, string> = {}
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  let body: BodyInit | undefined
  if (opts.json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.json) }
  if (opts.form) body = opts.form
  return fetch(BASE + url, { method, headers, body })
}

async function signup(email: string, name = 'Test') {
  const r = await call('POST', '/signup', { json: { email, password: 'Tr0ub4dor&3xKq', name, age: 30 } })
  assert.equal(r.status, 200)
  return (await r.json()) as { token: string; user: { bumpId: string; status: string; role: string } }
}

const files = (selfie: Buffer, voice: Buffer, selfieName = 'me.jpg') => {
  const f = new FormData()
  f.set('selfie', new Blob([new Uint8Array(selfie)], { type: 'image/jpeg' }), selfieName)
  f.set('voice', new Blob([new Uint8Array(voice)], { type: 'audio/webm' }), 'v.webm')
  return f
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'connectly-test-'))
  proc = spawn(process.execPath, ['src/server.ts'], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(dir, 't.db'), UPLOAD_DIR: path.join(dir, 'up'), ADMIN_EMAILS: 'admin@x.test' },
    stdio: 'ignore',
  })
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('server did not start')
})

after(async () => {
  proc.kill()
  await rm(dir, { recursive: true, force: true })
})

describe('verification flow', () => {
  it('new users are unverified and blocked from the wall, actions and chat', async () => {
    const { token, user } = await signup('u1@x.test')
    assert.equal(user.status, 'unverified')
    assert.equal(user.role, 'user')
    for (const [m, u] of [['GET', '/profiles'], ['GET', '/connections'], ['POST', '/actions']] as const) {
      const r = await call(m, u, { token, json: m === 'POST' ? { bumpId: 'X', action: 'like' } : undefined })
      assert.equal(r.status, 403, u)
      assert.equal(((await r.json()) as any).error, 'not_verified')
    }
  })

  it('validates uploads by content, size and completeness', async () => {
    const { token } = await signup('u2@x.test')
    // wrong content, even though the client claims image/jpeg
    let r = await call('POST', '/verification', { token, form: files(Buffer.from('<html>not an image</html>'), WEBM) })
    assert.equal(r.status, 415)
    // missing voice
    const f = new FormData(); f.set('selfie', new Blob([new Uint8Array(JPEG)]), 'a.jpg')
    r = await call('POST', '/verification', { token, form: f })
    assert.equal(r.status, 400)
    // selfie over 5 MB
    r = await call('POST', '/verification', { token, form: files(Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]), WEBM) })
    assert.equal(r.status, 413)
    // still unverified after all failures
    const me = await (await call('GET', '/me', { token })).json() as any
    assert.equal(me.status, 'unverified')
  })

  it('submit -> pending -> reject (with reason) -> resubmit -> approve -> active', async () => {
    const admin = await signup('admin@x.test', 'Admin')
    assert.equal(admin.user.role, 'admin')
    assert.equal(admin.user.status, 'active')
    const u = await signup('u3@x.test', 'Una')

    // client-supplied filename is ignored (path traversal attempt)
    let r = await call('POST', '/verification', { token: u.token, form: files(JPEG, WEBM, '../../evil.jpg') })
    assert.equal(r.status, 201)
    r = await call('POST', '/verification', { token: u.token, form: files(JPEG, WEBM) })
    assert.equal(r.status, 409, 'second submission while pending')

    // non-admins cannot use admin routes
    assert.equal((await call('GET', '/admin/verifications', { token: u.token })).status, 403)

    const list = await (await call('GET', '/admin/verifications', { token: admin.token })).json() as any[]
    const item = list.find((x) => x.user.bumpId === u.user.bumpId)
    assert.ok(item)
    assert.equal(item.status, 'pending')

    // media is viewable by admin only, with the sniffed type
    const img = await call('GET', `/admin/verifications/${item.id}/selfie`, { token: admin.token })
    assert.equal(img.status, 200)
    assert.equal(img.headers.get('content-type'), 'image/jpeg')
    assert.equal(img.headers.get('x-content-type-options'), 'nosniff')
    assert.equal((await call('GET', `/admin/verifications/${item.id}/selfie`, { token: u.token })).status, 403)
    assert.equal((await call('GET', `/admin/verifications/${item.id}/selfie`)).status, 401)

    // rejection needs a reason
    assert.equal((await call('POST', `/admin/verifications/${item.id}/decision`, { token: admin.token, json: { decision: 'reject' } })).status, 400)
    r = await call('POST', `/admin/verifications/${item.id}/decision`, { token: admin.token, json: { decision: 'reject', reason: 'Face not visible' } })
    assert.equal(r.status, 200)
    assert.equal((await call('POST', `/admin/verifications/${item.id}/decision`, { token: admin.token, json: { decision: 'approve' } })).status, 409, 'already decided')

    let me = await (await call('GET', '/me', { token: u.token })).json() as any
    assert.equal(me.status, 'rejected')
    assert.equal(me.rejectionReason, 'Face not visible')

    // resubmit and approve
    assert.equal((await call('POST', '/verification', { token: u.token, form: files(JPEG, WEBM) })).status, 201)
    me = await (await call('GET', '/me', { token: u.token })).json() as any
    assert.equal(me.status, 'pending')
    const next = (await (await call('GET', '/admin/verifications', { token: admin.token })).json() as any[]).find((x) => x.user.bumpId === u.user.bumpId)
    assert.ok(next && next.id !== item.id)
    assert.equal((await call('POST', `/admin/verifications/${next.id}/decision`, { token: admin.token, json: { decision: 'approve' } })).status, 200)

    me = await (await call('GET', '/me', { token: u.token })).json() as any
    assert.equal(me.status, 'active')
    assert.equal(me.rejectionReason, null)
    assert.equal((await call('GET', '/profiles', { token: u.token })).status, 200)
  })

  it('unverified profiles never appear on the wall', async () => {
    const a = await signup('admin@x.test').catch(() => null) // already exists -> 409 throws in signup
    void a
    const login = await (await call('POST', '/login', { json: { email: 'admin@x.test', password: 'Tr0ub4dor&3xKq' } })).json() as any
    const wall = await (await call('GET', '/profiles', { token: login.token })).json() as any[]
    // u1/u2 are unverified, u3 is active; only u3 may show.
    assert.deepEqual(wall.map((p) => p.name), ['Una'])
  })
})

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)])

async function adminToken() {
  const r = await call('POST', '/login', { json: { email: 'admin@x.test', password: 'Tr0ub4dor&3xKq' } })
  return ((await r.json()) as any).token as string
}

/** Signs up a user and gets them verified, returning their token and bumpId. */
async function activeUser(email: string, name: string) {
  const u = await signup(email, name)
  assert.equal((await call('POST', '/verification', { token: u.token, form: files(JPEG, WEBM) })).status, 201)
  const admin = await adminToken()
  const list = (await (await call('GET', '/admin/verifications', { token: admin })).json()) as any[]
  const item = list.find((x) => x.user.bumpId === u.user.bumpId)
  assert.equal((await call('POST', `/admin/verifications/${item.id}/decision`, { token: admin, json: { decision: 'approve' } })).status, 200)
  return u
}

function pay(planId: string, reference: string, proof: Buffer = PNG) {
  const f = new FormData()
  f.set('planId', planId)
  f.set('reference', reference)
  f.set('proof', new Blob([new Uint8Array(proof)], { type: 'image/png' }), 'proof.png')
  return f
}

describe('memberships and payments', () => {
  it('matching is free but sending messages needs a membership', async () => {
    const a = await activeUser('pa@x.test', 'Pa')
    const b = await activeUser('pb@x.test', 'Pb')
    await call('POST', '/actions', { token: a.token, json: { bumpId: b.user.bumpId, action: 'like' } })
    const m = (await (await call('POST', '/actions', { token: b.token, json: { bumpId: a.user.bumpId, action: 'like' } })).json()) as any
    assert.equal(m.matched, true)
    const r = await call('POST', `/connections/${m.connectionId}/messages`, { token: a.token, json: { body: 'hi' } })
    assert.equal(r.status, 402)
    assert.equal(((await r.json()) as any).error, 'membership_required')
    // reading is still allowed
    assert.equal((await call('GET', `/connections/${m.connectionId}/messages`, { token: a.token })).status, 200)
  })

  it('rejects bad input and unverified users', async () => {
    const un = await signup('unv@x.test')
    assert.equal((await call('GET', '/membership/plans', { token: un.token })).status, 403)

    const u = await activeUser('pc@x.test', 'Pc')
    const plans = (await (await call('GET', '/membership/plans', { token: u.token })).json()) as any
    assert.ok(plans.plans.length >= 1)
    assert.equal((await call('POST', '/payments', { token: u.token, form: pay('nope', 'UTR123456') })).status, 400, 'unknown plan')
    assert.equal((await call('POST', '/payments', { token: u.token, form: pay('monthly', 'x') })).status, 400, 'short reference')
    assert.equal((await call('POST', '/payments', { token: u.token, form: pay('monthly', 'UTR123456', Buffer.from('not an image')) })).status, 415)
    assert.equal((await call('POST', '/payments', { token: u.token, form: pay('monthly', 'UTR123456', Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)])) })).status, 413)
    assert.deepEqual(await (await call('GET', '/payments/mine', { token: u.token })).json(), [], 'nothing recorded after failures')
  })

  it('submit -> reject -> resubmit -> approve grants time; renewals stack', async () => {
    const admin = await adminToken()
    const u = await activeUser('pd@x.test', 'Pd')
    const other = await activeUser('pe@x.test', 'Pe')

    assert.equal((await call('POST', '/payments', { token: u.token, form: pay('monthly', 'utr111111') })).status, 201)
    assert.equal((await call('POST', '/payments', { token: u.token, form: pay('monthly', 'UTR222222', Buffer.concat([PNG, Buffer.from('x')])) })).status, 409, 'one pending at a time')

    // the same reference (any case) or screenshot can't be reused by someone else while it's live
    let r = await call('POST', '/payments', { token: other.token, form: pay('monthly', 'UTR111111', Buffer.concat([PNG, Buffer.from('y')])) })
    assert.equal(((await r.json()) as any).error, 'reference_used')
    r = await call('POST', '/payments', { token: other.token, form: pay('monthly', 'UTR333333') })
    assert.equal(((await r.json()) as any).error, 'proof_reused')

    // non-admins can't see the queue or proofs
    assert.equal((await call('GET', '/admin/payments', { token: u.token })).status, 403)

    const queue = (await (await call('GET', '/admin/payments', { token: admin })).json()) as any[]
    const item = queue.find((p) => p.user.bumpId === u.user.bumpId)
    assert.equal(item.amountPaise, 49900, 'price comes from the server plan')
    assert.equal(item.reference, 'UTR111111')
    const proof = await call('GET', `/admin/payments/${item.id}/proof`, { token: admin })
    assert.equal(proof.status, 200)
    assert.equal(proof.headers.get('content-type'), 'image/png')
    assert.equal((await call('GET', `/admin/payments/${item.id}/proof`, { token: u.token })).status, 403)

    assert.equal((await call('POST', `/admin/payments/${item.id}/decision`, { token: admin, json: { decision: 'reject' } })).status, 400, 'reason required')
    assert.equal((await call('POST', `/admin/payments/${item.id}/decision`, { token: admin, json: { decision: 'reject', reason: 'Amount does not match' } })).status, 200)
    let me = (await (await call('GET', '/me', { token: u.token })).json()) as any
    assert.equal(me.isMember, false)
    const hist = (await (await call('GET', '/payments/mine', { token: u.token })).json()) as any[]
    assert.equal(hist[0].status, 'rejected')
    assert.equal(hist[0].reason, 'Amount does not match')

    // a rejected reference/screenshot frees up, so the user can fix and resubmit
    assert.equal((await call('POST', '/payments', { token: u.token, form: pay('monthly', 'UTR111111') })).status, 201)
    const next = ((await (await call('GET', '/admin/payments', { token: admin })).json()) as any[]).find((p) => p.user.bumpId === u.user.bumpId)
    assert.equal((await call('POST', `/admin/payments/${next.id}/decision`, { token: admin, json: { decision: 'approve' } })).status, 200)
    assert.equal((await call('POST', `/admin/payments/${next.id}/decision`, { token: admin, json: { decision: 'approve' } })).status, 409, 'no double credit')

    me = (await (await call('GET', '/me', { token: u.token })).json()) as any
    assert.equal(me.isMember, true)
    const DAY = 86400000
    const first = me.membershipExpiresAt as number
    assert.ok(Math.abs(first - (Date.now() + 30 * DAY)) < 60_000)

    // renewal stacks on top of the remaining time
    assert.equal((await call('POST', '/payments', { token: u.token, form: pay('quarterly', 'UTR444444', Buffer.concat([PNG, Buffer.from('z')])) })).status, 201)
    const renew = ((await (await call('GET', '/admin/payments', { token: admin })).json()) as any[]).find((p) => p.user.bumpId === u.user.bumpId)
    assert.equal((await call('POST', `/admin/payments/${renew.id}/decision`, { token: admin, json: { decision: 'approve' } })).status, 200)
    me = (await (await call('GET', '/me', { token: u.token })).json()) as any
    assert.equal(me.membershipExpiresAt, first + 90 * DAY)
  })

  it('a paid member can send messages while an unpaid peer stays blocked', async () => {
    const paid = (await (await call('POST', '/login', { json: { email: 'pd@x.test', password: 'Tr0ub4dor&3xKq' } })).json()) as any
    const peer = await activeUser('pf@x.test', 'Pf')
    await call('POST', '/actions', { token: paid.token, json: { bumpId: peer.user.bumpId, action: 'like' } })
    const m = (await (await call('POST', '/actions', { token: peer.token, json: { bumpId: paid.user.bumpId, action: 'like' } })).json()) as any
    assert.equal((await call('POST', `/connections/${m.connectionId}/messages`, { token: paid.token, json: { body: 'hello' } })).status, 200)
    assert.equal((await call('POST', `/connections/${m.connectionId}/messages`, { token: peer.token, json: { body: 'blocked' } })).status, 402)
  })
})
