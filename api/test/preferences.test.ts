import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const PORT = 4200 + Math.floor(Math.random() * 100)
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
// Only the members created for the wall test: earlier tests leave other active members on the wall.
const COHORT = new Set(['Young', 'Mid', 'Old', 'None'])
const wallNames = async (token: string) => {
  const r = await call('GET', '/profiles?limit=50', { token })
  assert.equal(r.status, 200)
  return ((await r.json()) as any[]).map((p) => p.name as string).filter((n) => COHORT.has(n)).sort()
}
const put = (token: string, json?: unknown) => call('PUT', '/preferences', { token, json })

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'connectly-prefs-'))
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

describe('preferences API', () => {
  it('requires a token and a verified account', async () => {
    for (const m of ['GET', 'PUT', 'DELETE']) assert.equal((await call(m, '/preferences')).status, 401, m)
    const un = await signup('unv@x.test', 'Unv')
    for (const m of ['GET', 'PUT', 'DELETE']) {
      const r = await call(m, '/preferences', { token: un.token })
      assert.equal(r.status, 403, m)
      assert.equal(((await r.json()) as any).error, 'not_verified')
    }
  })

  it('returns empty defaults, stores valid input and clears it', async () => {
    const u = await activeUser('p1@x.test', 'P1')
    const empty = { minAge: null, maxAge: null, interests: [], city: '', languages: [] }
    assert.deepEqual(await (await call('GET', '/preferences', { token: u.token })).json(), empty)

    let r = await put(u.token, { minAge: 25, maxAge: 40, interests: ['  Hiking ', 'hiking', 'Jazz'] })
    assert.equal(r.status, 200)
    const saved = { minAge: 25, maxAge: 40, interests: ['Hiking', 'Jazz'], city: '', languages: [] }
    assert.deepEqual(await r.json(), saved)
    assert.deepEqual(await (await call('GET', '/preferences', { token: u.token })).json(), saved)

    // PUT replaces: omitted fields are unset
    r = await put(u.token, { minAge: 30 })
    assert.deepEqual(await r.json(), { ...empty, minAge: 30 })
    r = await put(u.token, { ...empty, maxAge: 120 })
    assert.deepEqual(await r.json(), { ...empty, maxAge: 120 })

    // empty body (no content type) and {} both clear everything
    await put(u.token, saved)
    r = await call('PUT', '/preferences', { token: u.token })
    assert.equal(r.status, 200)
    assert.deepEqual(await r.json(), empty)
    await put(u.token, saved)
    assert.deepEqual(await (await put(u.token, {})).json(), empty)

    await put(u.token, saved)
    r = await call('DELETE', '/preferences', { token: u.token })
    assert.equal(r.status, 200)
    assert.deepEqual(await (await call('GET', '/preferences', { token: u.token })).json(), empty)
  })

  it('rejects invalid input and keeps the previous value', async () => {
    const u = await activeUser('p2@x.test', 'P2')
    const good = { minAge: 20, maxAge: 30, interests: ['a'], city: '', languages: [] as string[] }
    await put(u.token, good)
    const bad: unknown[] = [
      { minAge: 17 }, { minAge: 121 }, { maxAge: 17 }, { maxAge: 121 },
      { minAge: 25.5 }, { minAge: '25' }, { maxAge: 'x' },
      { minAge: 40, maxAge: 30 },
      { interests: Array.from({ length: 13 }, (_, i) => `i${i}`) },
      { interests: [''] }, { interests: ['   '] }, { interests: ['x'.repeat(31)] }, { interests: [5] }, { interests: 'hiking' },
      { surprise: true },
      [], 'text',
    ]
    for (const b of bad) {
      const r = await put(u.token, b)
      assert.equal(r.status, 400, JSON.stringify(b))
      assert.equal(((await r.json()) as any).error, 'invalid_input')
    }
    assert.deepEqual(await (await call('GET', '/preferences', { token: u.token })).json(), good)
  })

  it('accepts the boundary values', async () => {
    const u = await activeUser('p3@x.test', 'P3')
    const twelve = Array.from({ length: 12 }, (_, i) => `i${i}`)
    const r = await put(u.token, { minAge: 18, maxAge: 18, interests: [...twelve.slice(0, 11), 'y'.repeat(30)] })
    assert.equal(r.status, 200)
    assert.equal((await put(u.token, { minAge: 120, maxAge: 120 })).status, 200)
    // 12 entries that collapse to fewer by case-insensitive de-duplication are fine too
    assert.equal((await put(u.token, { interests: twelve })).status, 200)
  })
})

describe('wall filtering', () => {
  it('applies age range and interests to the wall only, per viewer', async () => {
    const viewer = await activeUser('w-viewer@x.test', 'Viewer', 30)
    const other = await activeUser('w-other@x.test', 'Other', 30)
        const young = await woman('w-young@x.test', 'Young', 22, ['Hiking', 'Jazz'])
    await woman('w-mid@x.test', 'Mid', 35, ['chess', 'Cooking'])
    await woman('w-old@x.test', 'Old', 50, ['HIKING'])
    await woman('w-none@x.test', 'None', 28)
    // unverified candidates never appear regardless of filters
    await signup('w-unv@x.test', 'Unv2', 28, ['hiking'], 'woman')

    const everyone = ['None', 'Old', 'Mid', 'Young'].sort()
    // no filter => everyone
    assert.deepEqual(await wallNames(viewer.token), everyone)

    // age range, inclusive on both ends
    await put(viewer.token, { minAge: 22, maxAge: 35 })
    assert.deepEqual(await wallNames(viewer.token), ['Mid', 'None', 'Young'])
    await put(viewer.token, { minAge: 36 })
    assert.deepEqual(await wallNames(viewer.token), ['Old'])
    await put(viewer.token, { maxAge: 21 })
    assert.deepEqual(await wallNames(viewer.token), [])

    // interests: case-insensitive, any-of
    await put(viewer.token, { interests: ['hiking'] })
    assert.deepEqual(await wallNames(viewer.token), ['Old', 'Young'])
    await put(viewer.token, { interests: ['CHESS', 'jazz'] })
    assert.deepEqual(await wallNames(viewer.token), ['Mid', 'Young'])
    await put(viewer.token, { interests: ['nothing-matches'] })
    assert.deepEqual(await wallNames(viewer.token), [])

    // age and interests combine with AND
    await put(viewer.token, { minAge: 40, interests: ['hiking', 'chess'] })
    assert.deepEqual(await wallNames(viewer.token), ['Old'])

    // quote and wildcard characters are treated as plain values
    await put(viewer.token, { interests: ["'; DROP TABLE users; --", '%'] })
    assert.deepEqual(await wallNames(viewer.token), [])
    assert.equal((await call('GET', '/me', { token: viewer.token })).status, 200)

    // another member's wall is unaffected by the viewer's preferences, and vice versa
    assert.deepEqual(await wallNames(other.token), everyone)
    await put(other.token, { maxAge: 25 })
    assert.deepEqual(await wallNames(other.token), ['Young'])
    assert.equal((await call('GET', '/profiles', { token: young.token })).status, 403, 'women have no wall')
    assert.deepEqual(await wallNames(viewer.token), [])

    // clearing restores the full wall
    assert.equal((await call('DELETE', '/preferences', { token: viewer.token })).status, 200)
    assert.deepEqual(await wallNames(viewer.token), everyone)
  })

  it('does not filter the connections list', async () => {
    const a = await activeUser('c-a@x.test', 'Ca', 30)
    const b = await woman('c-b@x.test', 'Cb', 60, ['chess'])
    const d = new DatabaseSync(path.join(dir, 't.db'))
    d.prepare('UPDATE users SET request_credits = 3 WHERE email = ?').run('c-a@x.test')
    d.close()
    const sent = await call('POST', '/requests', { token: a.token, json: { memberId: b.user.memberId, note: 'hello' } })
    assert.equal(sent.status, 201)
    const m = (await (await call('POST', `/requests/${((await sent.json()) as any).id}/decision`, { token: b.token, json: { decision: 'accept' } })).json()) as any
    assert.equal(m.status, 'accepted')

    await put(a.token, { maxAge: 25, interests: ['nothing-matches'] })
    const conns = (await (await call('GET', '/connections', { token: a.token })).json()) as any[]
    assert.deepEqual(conns.map((c) => c.profile.name), ['Cb'])
  })

  it('never exposes preferences to other members', async () => {
    const a = await activeUser('x-a@x.test', 'Xa')
    const b = await activeUser('x-b@x.test', 'Xb')
    await put(a.token, { minAge: 33, maxAge: 44, interests: ['secret-interest-filter'] })
    assert.deepEqual(await (await call('GET', '/preferences', { token: b.token })).json(), { minAge: null, maxAge: null, interests: [], city: '', languages: [] })
    const wall = JSON.stringify(await (await call('GET', '/profiles', { token: b.token })).json())
    assert.ok(!wall.includes('secret-interest-filter'))
    const me = JSON.stringify(await (await call('GET', '/me', { token: b.token })).json())
    assert.ok(!me.includes('secret-interest-filter'))
  })
})
