import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const PORT = 5300 + Math.floor(Math.random() * 90)
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
  dir = await mkdtemp(path.join(tmpdir(), 'connectly-skipped-'))
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


const skip = (m: Member, to: Member) => call('POST', '/actions', { token: m.token, json: { memberId: to.memberId, action: 'skip' } })
const wall = async (m: Member) => (await j(await call('GET', '/profiles', { token: m.token }))) as any[]
const skipped = async (m: Member) => (await j(await call('GET', '/profiles/skipped', { token: m.token }))) as any[]

describe('skipped profiles', () => {
  it('lists skipped members, newest first, and leaves them out of the community list', async () => {
    const man = await active('man', 'Arjun', 3), w1 = await active('woman', 'Asha'), w2 = await active('woman', 'Bela')
    assert.equal((await skip(man, w1)).status, 200)
    await new Promise((r) => setTimeout(r, 5))
    assert.equal((await skip(man, w2)).status, 200)
    const list = await skipped(man)
    assert.deepEqual(list.map((p) => p.memberId), [w2.memberId, w1.memberId])
    assert.ok(list[0].skippedAt > 0)
    const ids = (await wall(man)).map((p) => p.memberId)
    assert.ok(!ids.includes(w1.memberId) && !ids.includes(w2.memberId))
  })

  it('brings a skipped member back to the community list', async () => {
    const man = await active('man', 'Arjun', 3), w = await active('woman', 'Asha')
    await skip(man, w)
    assert.equal((await call('DELETE', `/actions/${w.memberId}`, { token: man.token })).status, 200)
    assert.equal((await skipped(man)).length, 0)
    assert.ok((await wall(man)).some((p) => p.memberId === w.memberId))
    assert.equal((await call('DELETE', `/actions/${w.memberId}`, { token: man.token })).status, 404)
  })

  it('drops someone from the skipped list once a request is sent to her', async () => {
    const man = await active('man', 'Arjun', 3), w = await active('woman', 'Asha')
    await skip(man, w)
    assert.equal((await sendRequest(man, w, 'Changed my mind, hello')).status, 201)
    assert.equal((await skipped(man)).length, 0)
  })

  it('hides blocked members and is only for men', async () => {
    const man = await active('man', 'Arjun', 3), w = await active('woman', 'Asha')
    await skip(man, w)
    assert.equal((await call('POST', '/blocks', { token: w.token, json: { memberId: man.memberId } })).status < 300, true)
    assert.equal((await skipped(man)).length, 0)
    assert.equal((await call('GET', '/profiles/skipped', { token: w.token })).status, 403)
  })
})
