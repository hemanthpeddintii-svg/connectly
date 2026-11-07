import { after, before, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const PORT = 5250 + Math.floor(Math.random() * 50)
const BASE = `http://127.0.0.1:${PORT}/v0`
const PW = 'Tr0ub4dor&3xKq'
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)])
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)])
let proc: ChildProcess
let dir: string

const call = (method: string, url: string, token?: string, json?: unknown, form?: FormData) =>
  fetch(BASE + url, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(json !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: form ?? (json !== undefined ? JSON.stringify(json) : undefined),
  })
const j = async (r: Response) => (await r.json()) as any

let n = 0
async function signup(email: string, gender: 'man' | 'woman', name: string) {
  const r = await call('POST', '/signup', undefined, { email, password: PW, name, age: 30, gender, agreeToTerms: true })
  assert.equal(r.status, 200)
  const b = await j(r)
  return { token: b.token as string, bumpId: b.user.bumpId as string }
}

async function verified(admin: string, gender: 'man' | 'woman', name: string) {
  const m = await signup(`a${++n}-${name.toLowerCase()}@x.test`, gender, name)
  const f = new FormData()
  f.set('selfie', new Blob([new Uint8Array(JPEG)], { type: 'image/jpeg' }), 'a.jpg')
  f.set('voice', new Blob([new Uint8Array(WEBM)], { type: 'audio/webm' }), 'v.webm')
  assert.equal((await call('POST', '/verification', m.token, undefined, f)).status, 201)
  const item = ((await j(await call('GET', '/admin/verifications', admin))) as any[]).find((x) => x.user.bumpId === m.bumpId)
  assert.equal((await call('POST', `/admin/verifications/${item.id}/decision`, admin, { decision: 'approve' })).status, 200)
  return m
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'connectly-audit-'))
  proc = spawn(process.execPath, ['src/server.ts'], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(dir, 't.db'), UPLOAD_DIR: path.join(dir, 'up'), ADMIN_EMAILS: 'admin@x.test', RATE_LIMIT: 'off' },
    stdio: 'ignore',
  })
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('server did not start')
})
after(async () => { proc.kill(); await rm(dir, { recursive: true, force: true }) })

it('report decisions and lifting a suspension are recorded in the member audit trail', async () => {
  const admin = (await signup('admin@x.test', 'man', 'Admin')).token
  const reporter = await verified(admin, 'woman', 'Reporter')
  const offender = await verified(admin, 'man', 'Offender')

  assert.equal((await call('POST', '/reports', reporter.token, { bumpId: offender.bumpId, reason: 'harassment', details: 'rude' })).status, 201)
  const [item] = (await j(await call('GET', '/admin/reports?status=open', admin))) as any[]
  assert.ok(item)
  assert.equal((await call('POST', `/admin/reports/${item.report.id}/decision`, admin, { decision: 'action', note: 'Repeated rude messages', suspend: true })).status, 200)

  let detail = await j(await call('GET', `/admin/members/${offender.bumpId}`, admin))
  assert.ok(detail.audit.some((a: any) => a.action === 'report.actioned' && a.detail.suspended === true && a.detail.note === 'Repeated rude messages'), 'report decision audited')
  assert.equal(detail.member.suspended, true)

  assert.equal((await call('POST', `/admin/suspensions/${offender.bumpId}/lift`, admin)).status, 200)
  detail = await j(await call('GET', `/admin/members/${offender.bumpId}`, admin))
  assert.ok(detail.audit.some((a: any) => a.action === 'suspension.lifted'), 'lift audited')
  assert.equal(detail.member.suspended, false)
  assert.equal((await call('POST', `/admin/suspensions/${offender.bumpId}/lift`, admin)).status, 404, 'lifting twice finds nothing and writes no second entry')
  detail = await j(await call('GET', `/admin/members/${offender.bumpId}`, admin))
  assert.equal(detail.audit.filter((a: any) => a.action === 'suspension.lifted').length, 1)
})
