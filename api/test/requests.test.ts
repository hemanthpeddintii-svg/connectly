import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const PORT = 4900 + Math.floor(Math.random() * 90)
const ORIGIN = `127.0.0.1:${PORT}`
const BASE = `http://${ORIGIN}/v0`
const PW = 'Tr0ub4dor&3xKq'
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)])
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)])

let proc: ChildProcess
let dir: string
let dbPath: string

type Member = { email: string; token: string; bumpId: string; gender: 'man' | 'woman' }

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
async function signup(gender: 'man' | 'woman', name = 'Test'): Promise<Member> {
  const email = `m${++n}-${Math.random().toString(36).slice(2, 7)}@x.test`
  const r = await call('POST', '/signup', { json: { email, password: PW, name, age: 30, gender, interests: ['jazz'] } })
  assert.equal(r.status, 200, 'signup')
  const b = await j(r)
  return { email, token: b.token, bumpId: b.user.bumpId, gender }
}

/** The admin account is whichever signs up with an ADMIN_EMAILS address; created on first use. */
async function adminToken() {
  const login = await call('POST', '/login', { json: { email: 'admin@x.test', password: PW } })
  if (login.status === 200) return (await j(login)).token as string
  const created = await call('POST', '/signup', { json: { email: 'admin@x.test', password: PW, name: 'Admin', age: 30, gender: 'man' } })
  assert.equal(created.status, 200, 'admin signup')
  return (await j(created)).token as string
}

/** Signs up a member and gets them verified by the admin. */
async function active(gender: 'man' | 'woman', name = 'Test', credits = 0): Promise<Member> {
  const m = await signup(gender, name)
  const form = new FormData()
  form.set('selfie', new Blob([new Uint8Array(JPEG)], { type: 'image/jpeg' }), 'a.jpg')
  form.set('voice', new Blob([new Uint8Array(WEBM)], { type: 'audio/webm' }), 'v.webm')
  assert.equal((await call('POST', '/verification', { token: m.token, form })).status, 201)
  const admin = await adminToken()
  const list = (await j(await call('GET', '/admin/verifications', { token: admin }))) as any[]
  const item = list.find((x) => x.user.bumpId === m.bumpId)
  assert.equal((await call('POST', `/admin/verifications/${item.id}/decision`, { token: admin, json: { decision: 'approve' } })).status, 200)
  if (credits) setCredits(m.email, credits)
  return m
}

function setCredits(email: string, credits: number) {
  const db = new DatabaseSync(dbPath)
  db.prepare('UPDATE users SET request_credits = ? WHERE email = ?').run(credits, email)
  db.close()
}
const credits = async (m: Member) => (await j(await call('GET', '/me', { token: m.token }))).requestCredits as number

const sendRequest = (from: Member, to: Member, note = 'Hello there') => call('POST', '/requests', { token: from.token, json: { bumpId: to.bumpId, note } })
const decide = (woman: Member, requestId: string, decision: 'accept' | 'decline') => call('POST', `/requests/${requestId}/decision`, { token: woman.token, json: { decision } })
const inbox = async (w: Member, status = 'pending') => (await j(await call('GET', `/requests/received?status=${status}`, { token: w.token }))) as any[]

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'connectly-requests-'))
  dbPath = path.join(dir, 't.db')
  proc = spawn(process.execPath, ['src/server.ts'], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, UPLOAD_DIR: path.join(dir, 'up'), ADMIN_EMAILS: 'admin@x.test', RATE_LIMIT: 'off' },
    stdio: 'ignore',
  })
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://${ORIGIN}/health`)).ok) return } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('server did not start')
})
after(async () => {
  proc.kill()
  await rm(dir, { recursive: true, force: true })
})

describe('gender and the community list', () => {
  it('signup requires a gender and /me reports it with a zero balance', async () => {
    const r = await call('POST', '/signup', { json: { email: 'nog@x.test', password: PW, name: 'N', age: 30 } })
    assert.equal(r.status, 400)
    const m = await signup('woman')
    const me = await j(await call('GET', '/me', { token: m.token }))
    assert.equal(me.gender, 'woman')
    assert.equal(me.requestCredits, 0)
    assert.equal('isMember' in me, false)
  })

  it('an account without a gender can set it once and never switch', async () => {
    const m = await signup('man')
    const db = new DatabaseSync(dbPath); db.prepare('UPDATE users SET gender = NULL WHERE email = ?').run(m.email); db.close()
    assert.equal((await j(await call('GET', '/me', { token: m.token }))).gender, null)
    assert.equal((await call('PATCH', '/me', { token: m.token, json: { gender: 'woman' } })).status, 200)
    assert.equal((await j(await call('GET', '/me', { token: m.token }))).gender, 'woman')
    const r = await call('PATCH', '/me', { token: m.token, json: { gender: 'man' } })
    assert.equal(r.status, 409)
    assert.equal((await j(r)).error, 'gender_locked')
  })

  it('men see only verified women; women get no community list; skipped and requested women disappear', async () => {
    const man = await active('man', 'Browser', 5)
    const w1 = await active('woman', 'Wendy')
    const w2 = await active('woman', 'Wanda')
    const w3 = await active('woman', 'Wilma')
    const unverified = await signup('woman', 'Ghost')
    const otherMan = await active('man', 'Other')

    const seen = async () => ((await j(await call('GET', '/profiles', { token: man.token }))) as any[]).map((p) => p.name)
    let names = await seen()
    for (const w of ['Wendy', 'Wanda', 'Wilma']) assert.ok(names.includes(w), w)
    assert.ok(!names.includes('Ghost'), 'unverified women are not listed')
    assert.ok(!names.includes('Other'), 'men are not listed')
    assert.ok(!names.includes('Browser'), 'not yourself')
    assert.equal((await call('GET', '/profiles', { token: w1.token })).status, 403, 'women have no community list')
    void unverified; void otherMan

    assert.equal((await call('POST', '/actions', { token: man.token, json: { bumpId: w1.bumpId, action: 'skip' } })).status, 200)
    assert.equal((await sendRequest(man, w2)).status, 201)
    names = await seen()
    assert.ok(!names.includes('Wendy'), 'skipped')
    assert.ok(!names.includes('Wanda'), 'already requested')
    assert.ok(names.includes('Wilma'))
    // "like" no longer exists
    assert.equal((await call('POST', '/actions', { token: man.token, json: { bumpId: w3.bumpId, action: 'like' } })).status, 400)
  })
})

describe('sending a request', () => {
  it('costs one request, needs a balance, and refuses duplicates without charging', async () => {
    const man = await active('man', 'Sender', 1)
    const w1 = await active('woman', 'Aanya')
    const w2 = await active('woman', 'Bela')

    let r = await sendRequest(man, w1, 'I liked your interests.')
    assert.equal(r.status, 201)
    const body = await j(r)
    assert.equal(body.creditsLeft, 0)
    assert.equal(await credits(man), 0)

    r = await sendRequest(man, w1)
    assert.equal(r.status, 409, 'one request per pair')
    assert.equal((await j(r)).error, 'already_requested')

    r = await sendRequest(man, w2)
    assert.equal(r.status, 402)
    assert.equal((await j(r)).error, 'no_requests_left')
    assert.equal(await credits(man), 0, 'a refused request spends nothing')
  })

  it('validates who can send and to whom', async () => {
    const man = await active('man', 'Valid', 5)
    const woman = await active('woman', 'Vera')
    const man2 = await active('man', 'Vik')
    const unverified = await signup('man')
    setCredits(unverified.email, 3)

    assert.equal((await sendRequest(man, man2)).status, 404, 'only women can be requested')
    assert.equal((await sendRequest(woman, woman)).status, 403, 'a woman cannot send requests')
    assert.equal((await sendRequest(unverified, woman)).status, 403, 'unverified members cannot send')
    assert.equal((await call('POST', '/requests', { token: man.token, json: { bumpId: 'NOPE', note: 'x' } })).status, 404)
    assert.equal((await call('POST', '/requests', { token: man.token, json: { bumpId: woman.bumpId, note: 'x'.repeat(301) } })).status, 400)
    assert.equal((await call('POST', '/requests', { json: { bumpId: woman.bumpId } })).status, 401)
    assert.equal(await credits(man), 5, 'no failed attempt spent a request')
    // an empty note is allowed
    assert.equal((await call('POST', '/requests', { token: man.token, json: { bumpId: woman.bumpId } })).status, 201)
  })

  it('never spends more credits than the balance, even with simultaneous requests', async () => {
    const man = await active('man', 'Racer', 1)
    const ws = await Promise.all([active('woman', 'R1'), active('woman', 'R2'), active('woman', 'R3')])
    const results = await Promise.all(ws.map((w) => sendRequest(man, w)))
    const codes = results.map((r) => r.status).sort()
    assert.deepEqual(codes, [201, 402, 402])
    assert.equal(await credits(man), 0)
  })
})

describe('the inbox and deciding', () => {
  it('shows the woman her pending requests with the note and the sender, and nothing else', async () => {
    const man = await active('man', 'Arjun', 3)
    const woman = await active('woman', 'Maya')
    const other = await active('woman', 'Priya')
    await sendRequest(man, woman, 'Loved that you cook on weekdays.')

    const items = await inbox(woman)
    assert.equal(items.length, 1)
    assert.equal(items[0].note, 'Loved that you cook on weekdays.')
    assert.equal(items[0].from.name, 'Arjun')
    assert.equal(items[0].status, 'pending')
    assert.equal('email' in items[0].from, false, 'the sender\'s email is never exposed')
    assert.equal((await inbox(other)).length, 0, 'other women see nothing')
    assert.equal((await call('GET', '/requests/received', { token: man.token })).status, 403, 'men have no inbox')
    assert.equal((await call('GET', '/requests/received?status=bogus', { token: woman.token })).status, 400)

    const sent = (await j(await call('GET', '/requests/sent', { token: man.token }))) as any[]
    assert.equal(sent.length, 1)
    assert.equal(sent[0].status, 'pending')
    assert.equal(sent[0].to.name, 'Maya')
    assert.equal(sent[0].connectionId, null)
    assert.equal((await call('GET', '/requests/sent', { token: woman.token })).status, 403)
  })

  it('accepting opens a chat, and the Chats list returns the real connection id', async () => {
    const man = await active('man', 'Dev', 2)
    const woman = await active('woman', 'Nisha')
    await sendRequest(man, woman, 'Hi Nisha')
    const [req] = await inbox(woman)

    // only the addressee decides
    const stranger = await active('woman', 'Stranger')
    assert.equal((await decide(stranger, req.id, 'accept')).status, 404)
    assert.equal((await call('POST', `/requests/${req.id}/decision`, { token: man.token, json: { decision: 'accept' } })).status, 403)

    const r = await decide(woman, req.id, 'accept')
    assert.equal(r.status, 200)
    const { status, connectionId } = await j(r)
    assert.equal(status, 'accepted')
    assert.ok(connectionId)

    // regression: the chats list must expose the CONNECTION id (it used to return the member's id)
    for (const [who, other] of [[man, woman], [woman, man]] as const) {
      const list = (await j(await call('GET', '/connections', { token: who.token }))) as any[]
      assert.equal(list.length >= 1, true)
      const entry = list.find((c) => c.profile.bumpId === other.bumpId)
      assert.equal(entry.id, connectionId)
    }

    // chat is free: no payment, no membership
    assert.equal((await call('POST', `/connections/${connectionId}/messages`, { token: man.token, json: { body: 'Hello!' } })).status, 200)
    assert.equal((await call('POST', `/connections/${connectionId}/messages`, { token: woman.token, json: { body: 'Hi Dev' } })).status, 200)
    const msgs = (await j(await call('GET', `/connections/${connectionId}/messages`, { token: woman.token }))) as any[]
    assert.deepEqual(msgs.map((m) => m.body), ['Hello!', 'Hi Dev'])

    // the sender's list shows it as accepted with the chat id; her inbox no longer lists it as pending
    const sent = (await j(await call('GET', '/requests/sent', { token: man.token }))) as any[]
    assert.equal(sent[0].status, 'accepted')
    assert.equal(sent[0].connectionId, connectionId)
    assert.equal((await inbox(woman)).length, 0)
    assert.equal((await inbox(woman, 'accepted')).length, 1)
  })

  it('declining is final: it can be neither re-decided nor re-sent, and the credit is not refunded', async () => {
    const man = await active('man', 'Rejected', 2)
    const woman = await active('woman', 'Choosy')
    await sendRequest(man, woman)
    const [req] = await inbox(woman)

    const r = await decide(woman, req.id, 'decline')
    assert.equal(r.status, 200)
    assert.equal((await j(r)).status, 'declined')
    assert.equal((await decide(woman, req.id, 'accept')).status, 409, 'cannot flip a decision')
    assert.equal(((await j(await decide(woman, req.id, 'decline'))) as any).error, 'already_decided')

    const again = await sendRequest(man, woman)
    assert.equal(again.status, 409, 'a "not now" is respected')
    assert.equal(await credits(man), 1, 'the credit was spent and stays spent')
    const sent = (await j(await call('GET', '/requests/sent', { token: man.token }))) as any[]
    assert.equal(sent[0].status, 'declined')
    // the community list never offers her again
    const names = ((await j(await call('GET', '/profiles', { token: man.token }))) as any[]).map((p) => p.name)
    assert.ok(!names.includes('Choosy'))
  })

  it('two simultaneous accepts open exactly one chat', async () => {
    const man = await active('man', 'Twice', 1)
    const woman = await active('woman', 'Tap')
    await sendRequest(man, woman)
    const [req] = await inbox(woman)
    const [a, b] = await Promise.all([decide(woman, req.id, 'accept'), decide(woman, req.id, 'accept')])
    assert.deepEqual([a.status, b.status].sort(), [200, 409])
    const list = (await j(await call('GET', '/connections', { token: woman.token }))) as any[]
    assert.equal(list.filter((c) => c.profile.bumpId === man.bumpId).length, 1)
  })

  it('a block placed after the request still stops the accept and hides it from the inbox', async () => {
    const man = await active('man', 'Blocked', 2)
    const woman = await active('woman', 'Careful')
    await sendRequest(man, woman)
    const [req] = await inbox(woman)
    assert.equal((await call('POST', '/blocks', { token: woman.token, json: { bumpId: man.bumpId } })).status, 200)
    assert.equal((await inbox(woman)).length, 0, 'blocked senders vanish from the inbox')
    const r = await decide(woman, req.id, 'accept')
    assert.notEqual(r.status, 200, 'cannot accept a blocked member')
    const list = (await j(await call('GET', '/connections', { token: woman.token }))) as any[]
    assert.equal(list.filter((c) => c.profile.bumpId === man.bumpId).length, 0)
  })
})

describe('live updates', () => {
  const nextFrame = (ws: WebSocket, type: string) => new Promise<any>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no ${type} frame`)), 4000)
    ws.addEventListener('message', (e) => {
      const f = JSON.parse(String(e.data))
      if (f.type === type) { clearTimeout(t); resolve(f) }
    })
  })
  const open = (m: Member) => new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://${ORIGIN}/v0/ws?token=${encodeURIComponent(m.token)}`)
    ws.addEventListener('open', () => resolve(ws), { once: true })
    ws.addEventListener('error', () => reject(new Error('ws failed')), { once: true })
  })

  it('tells her when a request arrives and tells him when it is decided', async () => {
    const man = await active('man', 'Live', 1)
    const woman = await active('woman', 'Online')
    const womanWs = await open(woman)
    const manWs = await open(man)

    const arrived = nextFrame(womanWs, 'request')
    const sent = await j(await sendRequest(man, woman))
    const frame = await arrived
    assert.equal(typeof frame.requestId, 'string')

    const updated = nextFrame(manWs, 'request_update')
    const res = await j(await decide(woman, frame.requestId, 'accept'))
    const update = await updated
    assert.equal(update.requestId, frame.requestId)
    assert.equal(update.status, 'accepted')
    assert.equal(update.connectionId, res.connectionId)
    assert.ok(sent.id)
    womanWs.close(); manWs.close()
  })
})

describe('request packs add requests', () => {
  it('an approved payment tops up the balance so the man can send again', async () => {
    const man = await active('man', 'Buyer', 0)
    const woman = await active('woman', 'Seller')
    assert.equal((await sendRequest(man, woman)).status, 402)

    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)])
    const form = new FormData()
    form.set('planId', 'pack10')
    form.set('reference', 'UTR' + Date.now())
    form.set('proof', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'p.png')
    assert.equal((await call('POST', '/payments', { token: man.token, form })).status, 201)

    const admin = await adminToken()
    const queue = (await j(await call('GET', '/admin/payments', { token: admin }))) as any[]
    const item = queue.find((p) => p.user.bumpId === man.bumpId)
    assert.equal(item.requests, 10)
    assert.equal(item.amountPaise, 49900)
    assert.equal((await call('POST', `/admin/payments/${item.id}/decision`, { token: admin, json: { decision: 'approve' } })).status, 200)
    assert.equal(await credits(man), 10)
    assert.equal((await sendRequest(man, woman)).status, 201)
    assert.equal(await credits(man), 9)
  })
})
