import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const PORT = 4237 + Math.floor(Math.random() * 100)
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

type Session = { token: string; user: { memberId: string } }

async function signup(email: string, name: string, age = 30, interests: string[] = [], gender: 'man' | 'woman' = 'man') {
  const r = await call('POST', '/signup', { json: { agreeToTerms: true, email, password: 'Tr0ub4dor&3xKq', name, age, interests, gender } })
  assert.equal(r.status, 200)
  return (await r.json()) as Session
}

async function activeUser(email: string, name: string, age = 30, interests: string[] = [], gender: 'man' | 'woman' = 'man') {
  const u = await signup(email, name, age, interests, gender)
  const f = new FormData()
  f.set('selfie', new Blob([new Uint8Array(JPEG)], { type: 'image/jpeg' }), 'me.jpg')
  f.set('voice', new Blob([new Uint8Array(WEBM)], { type: 'audio/webm' }), 'v.webm')
  assert.equal((await call('POST', '/verification', { token: u.token, form: f })).status, 201)
  const admin = await signup('admin@x.test', 'Admin').catch(async () =>
    (await (await call('POST', '/login', { json: { email: 'admin@x.test', password: 'Tr0ub4dor&3xKq' } })).json()) as Session)
  const list = (await (await call('GET', '/admin/verifications', { token: admin.token })).json()) as any[]
  const item = list.find((x) => x.user.memberId === u.user.memberId)
  assert.equal((await call('POST', `/admin/verifications/${item.id}/decision`, { token: admin.token, json: { decision: 'approve' } })).status, 200)
  return u
}

const woman = (email: string, name: string, age = 30, interests: string[] = []) => activeUser(email, name, age, interests, 'woman')
const COHORT = new Set(['Asha','Bela','Chitra','Dina'])
const wallNames = async (token: string) => {
  const r = await call('GET', '/profiles?limit=50', { token })
  assert.equal(r.status, 200)
  return ((await r.json()) as any[]).map((p) => p.name as string).filter((n) => COHORT.has(n)).sort()
}
const put = (token: string, json?: unknown) => call('PUT', '/preferences', { token, json })

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'connectly-pf2-'))
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


const signupFull = async (email: string, name: string, extra: Record<string, unknown>) => {
  const r = await call('POST', '/signup', { json: { agreeToTerms: true, email, password: 'Tr0ub4dor&3xKq', name, age: 30, gender: 'woman', ...extra } })
  assert.equal(r.status, 200)
  return (await r.json()) as Session
}

describe('city and language filters', () => {
  it('stores languages on the profile and returns them', async () => {
    const u = await signupFull('lang1@x.test', 'Zed', { languages: ['English', 'Hindi'] })
    let me = (await (await call('GET', '/me', { token: u.token })).json()) as any
    assert.deepEqual(me.languages, ['English', 'Hindi'])
    const r = await call('PATCH', '/me', { token: u.token, json: { languages: ['Telugu'] } })
    assert.equal(r.status, 200)
    me = (await r.json()) as any
    assert.deepEqual(me.languages, ['Telugu'])
    for (const bad of [Array.from({ length: 9 }, (_, i) => `l${i}`), [''], ['x'.repeat(31)], 'English']) {
      assert.equal((await call('PATCH', '/me', { token: u.token, json: { languages: bad } })).status, 400)
    }
  })

  it('filters the wall by city and by language, and combines with age', async () => {
    const viewer = await activeUser('viewer@x.test', 'Viewer')
    const mk = async (name: string, extra: Record<string, unknown>) => {
      const u = await signupFull(`${name.toLowerCase()}@x.test`, name, extra)
      const f = new FormData()
      f.set('selfie', new Blob([new Uint8Array(JPEG)], { type: 'image/jpeg' }), 'me.jpg')
      f.set('voice', new Blob([new Uint8Array(WEBM)], { type: 'audio/webm' }), 'v.webm')
      assert.equal((await call('POST', '/verification', { token: u.token, form: f })).status, 201)
      const admin = (await (await call('POST', '/login', { json: { email: 'admin@x.test', password: 'Tr0ub4dor&3xKq' } })).json()) as Session
      const list = (await (await call('GET', '/admin/verifications', { token: admin.token })).json()) as any[]
      const item = list.find((x) => x.user.memberId === u.user.memberId)
      assert.equal((await call('POST', `/admin/verifications/${item.id}/decision`, { token: admin.token, json: { decision: 'approve' } })).status, 200)
    }
    await mk('Asha', { city: 'Hyderabad', languages: ['English', 'Telugu'], age: 26 })
    await mk('Bela', { city: ' hyderabad ', languages: ['hindi'], age: 40 })
    await mk('Chitra', { city: 'Pune', languages: ['Telugu'], age: 28 })
    await mk('Dina', { city: '', languages: [], age: 30 })

    assert.deepEqual(await wallNames(viewer.token), ['Asha', 'Bela', 'Chitra', 'Dina'])
    await put(viewer.token, { city: 'HYDERABAD' })
    assert.deepEqual(await wallNames(viewer.token), ['Asha', 'Bela'])
    await put(viewer.token, { languages: ['telugu'] })
    assert.deepEqual(await wallNames(viewer.token), ['Asha', 'Chitra'])
    await put(viewer.token, { city: 'Hyderabad', languages: ['Telugu', 'Hindi'], maxAge: 30 })
    assert.deepEqual(await wallNames(viewer.token), ['Asha'])
    assert.deepEqual(await (await call('GET', '/preferences', { token: viewer.token })).json(),
      { minAge: null, maxAge: 30, interests: [], city: 'Hyderabad', languages: ['Telugu', 'Hindi'] })
    assert.equal((await put(viewer.token, { city: 'x'.repeat(61) })).status, 400)
    assert.equal((await put(viewer.token, { languages: Array.from({ length: 9 }, (_, i) => `l${i}`) })).status, 400)
    await call('DELETE', '/preferences', { token: viewer.token })
    assert.deepEqual(await wallNames(viewer.token), ['Asha', 'Bela', 'Chitra', 'Dina'])
  })
})
