import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const PORT = 5400 + Math.floor(Math.random() * 90)
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
  dir = await mkdtemp(path.join(tmpdir(), 'connectly-terms-'))
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


const me = async (m: Member) => (await j(await call('GET', '/me', { token: m.token })))
const dbRow = (email: string) => { const d = new DatabaseSync(dbPath); const r = d.prepare('SELECT terms_agreed_at, terms_version FROM users WHERE email = ?').get(email) as any; d.close(); return r }

describe('agreeing to the terms', () => {
  it('refuses sign-up unless the terms are agreed', async () => {
    const r = await call('POST', '/signup', { json: { email: 'noterms@x.test', password: PW, name: 'N', age: 30, gender: 'man' } })
    assert.equal(r.status, 400)
    const r2 = await call('POST', '/signup', { json: { agreeToTerms: false, email: 'noterms2@x.test', password: PW, name: 'N', age: 30, gender: 'man' } })
    assert.equal(r2.status, 400)
  })

  it('records the time and the version when someone signs up', async () => {
    const m = await signup('woman', 'Asha')
    const row = dbRow(m.email)
    assert.ok(row.terms_agreed_at > 0)
    assert.match(row.terms_version, /^\d{4}-\d{2}-\d{2}$/)
    assert.equal((await me(m)).termsAgreed, true)
  })

  it('asks a member on an older version to agree again, then records the new version', async () => {
    const m = await signup('man', 'Arjun')
    const d = new DatabaseSync(dbPath); d.prepare("UPDATE users SET terms_version = '2020-01-01' WHERE email = ?").run(m.email); d.close()
    assert.equal((await me(m)).termsAgreed, false)
    assert.equal((await call('POST', '/me/agree-terms', { token: m.token })).status, 200)
    assert.equal((await me(m)).termsAgreed, true)
    assert.notEqual(dbRow(m.email).terms_version, '2020-01-01')
  })

  it('does not change the record when the current version is agreed to again', async () => {
    const m = await signup('man', 'Arjun')
    const before = dbRow(m.email)
    await new Promise((r) => setTimeout(r, 5))
    await call('POST', '/me/agree-terms', { token: m.token })
    assert.deepEqual(dbRow(m.email), before)
  })
})
