import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const PORT = 5100 + Math.floor(Math.random() * 40)
const BASE = `http://127.0.0.1:${PORT}/v0`
const PW = 'Tr0ub4dor&3xKq'
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)])
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)])
let proc: ChildProcess
let dir: string
let dbPath: string

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
const mail = () => `p${++n}-${Math.random().toString(36).slice(2, 7)}@x.test`

async function signup(gender: 'man' | 'woman', extra: Record<string, unknown> = {}) {
  const email = mail()
  const r = await call('POST', '/signup', { json: { email, password: PW, name: 'T', age: 30, gender, agreeToTerms: true, ...extra } })
  assert.equal(r.status, 200)
  const b = await j(r)
  return { email, token: b.token as string, user: b.user }
}
async function adminToken() {
  const l = await call('POST', '/login', { json: { email: 'admin@x.test', password: PW } })
  if (l.status === 200) return (await j(l)).token as string
  const c = await call('POST', '/signup', { json: { email: 'admin@x.test', password: PW, name: 'Admin', age: 30, gender: 'man', agreeToTerms: true } })
  return (await j(c)).token as string
}
async function active(gender: 'man' | 'woman') {
  const m = await signup(gender)
  const f = new FormData()
  f.set('selfie', new Blob([new Uint8Array(JPEG)], { type: 'image/jpeg' }), 'a.jpg')
  f.set('voice', new Blob([new Uint8Array(WEBM)], { type: 'audio/webm' }), 'v.webm')
  assert.equal((await call('POST', '/verification', { token: m.token, form: f })).status, 201)
  const admin = await adminToken()
  const list = (await j(await call('GET', '/admin/verifications', { token: admin }))) as any[]
  const item = list.find((x) => x.user.bumpId === m.user.bumpId)
  assert.equal((await call('POST', `/admin/verifications/${item.id}/decision`, { token: admin, json: { decision: 'approve' } })).status, 200)
  return m
}
function sql(q: string, ...p: any[]) {
  const d = new DatabaseSync(dbPath)
  d.prepare(q).run(...p)
  d.close()
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'connectly-profile-'))
  dbPath = path.join(dir, 't.db')
  proc = spawn(process.execPath, ['src/server.ts'], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, UPLOAD_DIR: path.join(dir, 'up'), ADMIN_EMAILS: 'admin@x.test', RATE_LIMIT: 'off' },
    stdio: 'ignore',
  })
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('server did not start')
})
after(async () => { proc.kill(); await rm(dir, { recursive: true, force: true }) })

describe('terms and profile fields', () => {
  it('signup requires agreeToTerms: true', async () => {
    const base = { email: mail(), password: PW, name: 'T', age: 30, gender: 'man' }
    assert.equal((await call('POST', '/signup', { json: base })).status, 400)
    assert.equal((await call('POST', '/signup', { json: { ...base, agreeToTerms: false } })).status, 400)
    assert.equal((await call('POST', '/signup', { json: { ...base, agreeToTerms: 'yes' } })).status, 400)
    const ok = await call('POST', '/signup', { json: { ...base, agreeToTerms: true } })
    assert.equal(ok.status, 200)
    assert.equal((await j(ok)).user.termsAgreed, true)
  })

  it('city and lookingFor round-trip with defaults, limits and PATCH', async () => {
    const plain = await signup('woman')
    assert.equal(plain.user.city, '')
    assert.equal(plain.user.lookingFor, '')
    const m = await signup('woman', { city: 'Pune', lookingFor: 'Friendship' })
    assert.equal(m.user.city, 'Pune')
    const bad = await call('POST', '/signup', { json: { email: mail(), password: PW, name: 'T', age: 30, gender: 'man', agreeToTerms: true, city: 'x'.repeat(61) } })
    assert.equal(bad.status, 400)
    const bad2 = await call('PATCH', '/me', { token: m.token, json: { lookingFor: 'y'.repeat(301) } })
    assert.equal(bad2.status, 400)
    const up = await j(await call('PATCH', '/me', { token: m.token, json: { city: 'Mumbai', lookingFor: 'Long chats' } }))
    assert.equal(up.city, 'Mumbai')
    assert.equal(up.lookingFor, 'Long chats')
    const me = await j(await call('GET', '/me', { token: m.token }))
    assert.equal(me.lookingFor, 'Long chats')
  })

  it('public profiles carry city/lookingFor but never email or termsAgreed', async () => {
    const w = await active('woman')
    await call('PATCH', '/me', { token: w.token, json: { city: 'Delhi' } })
    const man = await active('man')
    const wall = (await j(await call('GET', '/profiles', { token: man.token }))) as any[]
    const p = wall.find((x) => x.bumpId === w.user.bumpId)
    assert.equal(p.city, 'Delhi')
    assert.equal(p.email, undefined)
    assert.equal(p.termsAgreed, undefined)
  })

  it('POST /me/agree-terms backfills accounts created before terms existed', async () => {
    const m = await signup('man')
    sql('UPDATE users SET terms_agreed_at = NULL WHERE email = ?', m.email)
    assert.equal((await j(await call('GET', '/me', { token: m.token }))).termsAgreed, false)
    const r = await call('POST', '/me/agree-terms', { token: m.token })
    assert.deepEqual(await j(r), { termsAgreed: true })
    assert.equal((await j(await call('GET', '/me', { token: m.token }))).termsAgreed, true)
    assert.equal((await call('POST', '/me/agree-terms')).status, 401)
  })
})

describe('connections list, last message and unread', () => {
  async function connect() {
    const man = await active('man')
    const woman = await active('woman')
    sql('UPDATE users SET request_credits = 5 WHERE email = ?', man.email)
    const rq = await j(await call('POST', '/requests', { token: man.token, json: { bumpId: woman.user.bumpId, note: 'Hello there' } }))
    const inbox = (await j(await call('GET', '/requests/received?status=pending', { token: woman.token }))) as any[]
    const item = inbox.find((x) => x.id === rq.id) ?? inbox[0]
    const d = await call('POST', `/requests/${item.id}/decision`, { token: woman.token, json: { decision: 'accept' } })
    assert.equal(d.status, 200)
    const list = (await j(await call('GET', '/connections', { token: man.token }))) as any[]
    return { man, woman, connId: list[0].id as string }
  }

  it('reports lastMessage, unread, ordering and read marking', async () => {
    const a = await connect()
    const before = (await j(await call('GET', '/connections', { token: a.man.token }))) as any[]
    assert.equal(before[0].lastMessage, null)
    assert.equal(before[0].unread, 0)
    for (const t of ['one', 'two']) {
      assert.equal((await call('POST', `/connections/${a.connId}/messages`, { token: a.woman.token, json: { body: t } })).status, 200)
    }
    assert.equal((await call('POST', `/connections/${a.connId}/messages`, { token: a.man.token, json: { body: 'mine' } })).status, 200)
    const man = (await j(await call('GET', '/connections', { token: a.man.token }))) as any[]
    assert.equal(man[0].id, a.connId)
    assert.equal(man[0].unread, 2)
    assert.equal(man[0].lastMessage.preview, 'mine')
    assert.equal(man[0].lastMessage.mine, true)
    assert.equal(man[0].lastMessage.kind, 'text')
    const wom = (await j(await call('GET', '/connections', { token: a.woman.token }))) as any[]
    assert.equal(wom[0].unread, 1)
    assert.equal(wom[0].lastMessage.mine, false)
    assert.deepEqual(await j(await call('POST', `/connections/${a.connId}/read`, { token: a.man.token })), { ok: true })
    const after = (await j(await call('GET', '/connections', { token: a.man.token }))) as any[]
    assert.equal(after[0].unread, 0)
    // The other member's unread count is unaffected.
    assert.equal(((await j(await call('GET', '/connections', { token: a.woman.token }))) as any[])[0].unread, 1)
  })

  it('read is participants-only (404 for outsiders, 401 anonymous)', async () => {
    const a = await connect()
    const stranger = await active('man')
    assert.equal((await call('POST', `/connections/${a.connId}/read`, { token: stranger.token })).status, 404)
    assert.equal((await call('POST', `/connections/nope/read`, { token: a.man.token })).status, 404)
    assert.equal((await call('POST', `/connections/${a.connId}/read`)).status, 401)
  })
})
