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
  dir = await mkdtemp(path.join(tmpdir(), 'connectly-safeguards-'))
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


const put = async (token: string, json: unknown) => call('PUT', '/admin/settings', { token, json })
const getSettingsBody = async (token: string) => (await j(await call('GET', '/admin/settings', { token })))

describe('grievance officer', () => {
  it('is empty by default, saved by the admin, and shown on the public config', async () => {
    const admin = await adminToken()
    const before = await j(await call('GET', '/public-config'))
    assert.equal(before.grievanceName, '')
    assert.equal(before.grievanceEmail, '')
    const cur = await getSettingsBody(admin)
    const r = await put(admin, { ...cur, grievanceName: 'Asha Rao', grievanceEmail: 'grievance@example.test' })
    assert.equal(r.status, 200)
    const after = await j(await call('GET', '/public-config'))
    assert.equal(after.grievanceName, 'Asha Rao')
    assert.equal(after.grievanceEmail, 'grievance@example.test')
  })

  it('rejects a bad email', async () => {
    const admin = await adminToken()
    const cur = await getSettingsBody(admin)
    assert.equal((await put(admin, { ...cur, grievanceEmail: 'not-an-email' })).status, 400)
  })
})

describe('reports about a possible minor', () => {
  it('raise an urgent alert in the admin health view straight away, and clear it once decided', async () => {
    const admin = await adminToken()
    const a = await active('man', 'Arjun', 1), w = await active('woman', 'Meera')
    const r = await call('POST', '/reports', { token: a.token, json: { memberId: w.memberId, reason: 'underage', details: 'Looks young' } })
    assert.equal(r.status, 201)
    const health = await j(await call('GET', '/admin/health', { token: admin }))
    assert.ok(health.alerts.some((x: any) => x.key === 'underage_open'))
    const list = (await j(await call('GET', '/admin/reports?status=open', { token: admin }))) as any[]
    const item = list.find((x) => x.report.reason === 'underage')
    assert.ok(item)
    const d = await call('POST', `/admin/reports/${item.report.id}/decision`, { token: admin, json: { decision: 'dismiss' } })
    assert.ok(d.status < 300, `decision ${d.status}`)
    const after = await j(await call('GET', '/admin/health', { token: admin }))
    assert.ok(!after.alerts.some((x: any) => x.key === 'underage_open'))
  })
})
