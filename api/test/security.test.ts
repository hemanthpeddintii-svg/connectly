import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const PORT = 5500 + Math.floor(Math.random() * 90)
const ORIGIN = `127.0.0.1:${PORT}`
const BASE = `http://${ORIGIN}/v0`
const PW = 'Tr0ub4dor&3xKq'
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)])
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)])

let proc: ChildProcess
let dir: string
let dbPath: string

type Member = { email: string; token: string; memberId: string; gender: 'man' | 'woman' }

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
  const r = await call('POST', '/signup', { json: { agreeToTerms: true, email, password: PW, name, age: 30, gender, interests: ['jazz'] } })
  assert.equal(r.status, 200, 'signup')
  const b = await j(r)
  return { email, token: b.token, memberId: b.user.memberId, gender }
}

/** The admin account is whichever signs up with an ADMIN_EMAILS address; created on first use. */
async function adminToken() {
  const login = await call('POST', '/login', { json: { email: 'admin@x.test', password: PW } })
  if (login.status === 200) return (await j(login)).token as string
  const created = await call('POST', '/signup', { json: { agreeToTerms: true, email: 'admin@x.test', password: PW, name: 'Admin', age: 30, gender: 'man' } })
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
  const item = list.find((x) => x.user.memberId === m.memberId)
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

const sendRequest = (from: Member, to: Member, note = 'Hello there') => call('POST', '/requests', { token: from.token, json: { memberId: to.memberId, note } })
const decide = (woman: Member, requestId: string, decision: 'accept' | 'decline') => call('POST', `/requests/${requestId}/decision`, { token: woman.token, json: { decision } })
const inbox = async (w: Member, status = 'pending') => (await j(await call('GET', `/requests/received?status=${status}`, { token: w.token }))) as any[]

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'connectly-sec-'))
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


async function pair() {
  const man = await active('man', 'Arjun', 3), woman = await active('woman', 'Meera')
  const r = await sendRequest(man, woman, 'Hi, I liked your note about old films.')
  assert.equal(r.status, 201)
  const req = (await inbox(woman))[0]
  assert.equal((await decide(woman, req.id, 'accept')).status, 200)
  const conns = (await j(await call('GET', '/connections', { token: man.token }))) as any[]
  return { man, woman, id: conns[0].id as string }
}
const send = (m: Member, id: string, body: string, replyToId?: string) =>
  call('POST', `/connections/${id}/messages`, { token: m.token, json: { body, ...(replyToId ? { replyToId } : {}) } })
const edit = (m: Member, id: string, msgId: string, body: string) =>
  call('PATCH', `/connections/${id}/messages/${msgId}`, { token: m.token, json: { body } })
const list = async (m: Member, id: string) => (await j(await call('GET', `/connections/${id}/messages`, { token: m.token }))) as any[]




describe('nobody signed in', () => {
  for (const [method, url] of [['GET', '/me'], ['GET', '/connections'], ['GET', '/profiles'], ['GET', '/requests/sent'], ['GET', '/requests/received'], ['POST', '/requests'], ['GET', '/admin/members'], ['GET', '/admin/settings'], ['GET', '/account'], ['GET', '/profiles/skipped']]) {
    it(`${method} ${url} is refused`, async () => { assert.equal((await call(method, url)).status, 401) })
  }
  it('a forged token is refused', async () => {
    assert.equal((await call('GET', '/me', { token: 'eyJhbGciOiJIUzI1NiJ9.e30.abc' })).status, 401)
  })
})

describe('an ordinary member cannot reach the admin area', () => {
  for (const [method, url] of [['GET', '/admin/members'], ['GET', '/admin/members/X1'], ['GET', '/admin/payments'], ['GET', '/admin/payments/abc/proof'], ['GET', '/admin/verifications'], ['GET', '/admin/verifications/abc/selfie'], ['GET', '/admin/reports'], ['GET', '/admin/reports/abc/evidence'], ['GET', '/admin/settings'], ['GET', '/admin/invites'], ['POST', '/admin/invites'], ['POST', '/admin/members/X1/credits'], ['POST', '/admin/payments/abc/refund']]) {
    it(`${method} ${url} is forbidden`, async () => {
      const m = await active('man', 'Plain')
      const r = await call(method, url, method === 'GET' ? { token: m.token } : { token: m.token, json: {} })
      assert.ok(r.status === 403, `got ${r.status}`)
    })
  }
})

describe('members only see their own data', () => {
  it('a third member cannot read, write, close or edit someone else\'s chat', async () => {
    const man = await active('man', 'Arjun', 3), woman = await active('woman', 'Meera')
    await call('POST', '/requests', { token: man.token, json: { memberId: woman.memberId, note: 'Hello there friend' } })
    const req = (await j(await call('GET', '/requests/received?status=pending', { token: woman.token })))[0]
    await call('POST', `/requests/${req.id}/decision`, { token: woman.token, json: { decision: 'accept' } })
    const id = ((await j(await call('GET', '/connections', { token: man.token }))) as any[])[0].id
    const msg = await j(await send(man, id, 'private words'))
    const nosy = await active('man', 'Nosy')
    assert.equal((await call('GET', `/connections/${id}/messages`, { token: nosy.token })).status, 404)
    assert.equal((await send(nosy, id, 'let me in')).status, 404)
    assert.equal((await call('POST', `/connections/${id}/close`, { token: nosy.token, json: { kind: 'kind' } })).status, 404)
    assert.equal((await call('POST', `/connections/${id}/read`, { token: nosy.token })).status, 404)
    assert.equal((await call('GET', `/connections/${id}/attachments/quota`, { token: nosy.token })).status, 404)
    assert.equal((await call('PATCH', `/connections/${id}/messages/${msg.id}`, { token: nosy.token, json: { body: 'x' } })).status, 404)
    // The other participant cannot edit a message they did not write.
    assert.equal((await call('PATCH', `/connections/${id}/messages/${msg.id}`, { token: woman.token, json: { body: 'x' } })).status, 403)
    assert.equal((await j(await call('GET', '/connections', { token: nosy.token }))).length, 0)
  })

  it('a woman cannot decide a request addressed to someone else, and men cannot decide at all', async () => {
    const man = await active('man', 'Arjun', 3), a = await active('woman', 'Asha'), b = await active('woman', 'Bela')
    await call('POST', '/requests', { token: man.token, json: { memberId: a.memberId, note: 'Hello there friend' } })
    const req = (await j(await call('GET', '/requests/received?status=pending', { token: a.token })))[0]
    assert.equal((await call('POST', `/requests/${req.id}/decision`, { token: b.token, json: { decision: 'accept' } })).status, 404)
    assert.equal((await call('POST', `/requests/${req.id}/decision`, { token: man.token, json: { decision: 'accept' } })).status, 403)
    assert.equal((await j(await call('GET', '/requests/received?status=pending', { token: b.token }))).length, 0)
  })

  it('/me never returns a password hash or another member\'s email', async () => {
    const m = await active('man', 'Me')
    const text = await (await call('GET', '/me', { token: m.token })).text()
    assert.ok(!/password|hash|salt|token_version/i.test(text), 'no secrets in /me')
    const wall = await (await call('GET', '/profiles', { token: m.token })).text()
    assert.ok(!/@x\.test|password|hash/i.test(wall), 'no emails or hashes on the community list')
  })
})

describe('forms reject bad input without leaking details', () => {
  it('malformed JSON is a clean 400', async () => {
    const r = await fetch(BASE + '/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad json' })
    assert.equal(r.status, 400)
    assert.ok(!/at .*\.ts|node_modules|stack/i.test(await r.text()))
  })
  it('wrong types, huge and empty values are refused', async () => {
    assert.equal((await call('POST', '/login', { json: { email: 123, password: {} } })).status, 400)
    assert.equal((await call('POST', '/signup', { json: { email: 'a@b.co', password: 'x'.repeat(200), name: 'N', age: 30, gender: 'man', agreeToTerms: true } })).status, 400)
    assert.equal((await call('POST', '/signup', { json: { email: 'not-an-email', password: PW, name: 'N', age: 30, gender: 'man', agreeToTerms: true } })).status, 400)
    assert.equal((await call('POST', '/signup', { json: { email: 'kid@x.test', password: PW, name: 'N', age: 17, gender: 'man', agreeToTerms: true } })).status, 400)
    const m = await active('man', 'Typer')
    assert.equal((await call('PATCH', '/me', { token: m.token, json: { bio: 'x'.repeat(5000) } })).status, 400)
  })
  it('an unknown route returns a plain 404 with no stack trace', async () => {
    const r = await call('GET', '/definitely-not-here')
    assert.equal(r.status, 404)
    assert.ok(!/stack|\.ts:/i.test(await r.text()))
  })
  it('script and SQL text is stored as plain text and never run', async () => {
    const man = await active('man', 'Arjun', 3), woman = await active('woman', 'Meera')
    const evil = `'); DROP TABLE users;-- <script>alert(1)</script>`
    assert.equal((await call('POST', '/requests', { token: man.token, json: { memberId: woman.memberId, note: evil } })).status, 201)
    const got = (await j(await call('GET', '/requests/received?status=pending', { token: woman.token })))[0]
    assert.equal(got.note, evil)
    assert.equal((await call('GET', '/me', { token: man.token })).status, 200)
  })
})

describe('server errors are hidden', () => {
  it('an unexpected failure returns only a plain code', async () => {
    // A file name that cannot exist makes the static fallback fail without exposing paths.
    const r = await call('GET', '/connections/%00/messages/%00/attachment', { token: (await active('man', 'Err')).token })
    const text = await r.text()
    assert.ok(r.status < 500 || text === '{"error":"server_error"}', text)
    assert.ok(!/\.ts:|node_modules|SQLITE|stack/i.test(text))
  })
})
