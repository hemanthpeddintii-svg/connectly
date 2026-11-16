import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const PORT = 5200 + Math.floor(Math.random() * 90)
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
  dir = await mkdtemp(path.join(tmpdir(), 'connectly-chatedit-'))
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

describe('replying to a message', () => {
  it('shows what was replied to, from each side', async () => {
    const { man, woman, id } = await pair()
    const first = await j(await send(man, id, 'Which film would you watch again?'))
    assert.equal(first.replyTo, null)
    const reply = await j(await send(woman, id, 'Roman Holiday, every time.', first.id))
    assert.equal(reply.replyTo.id, first.id)
    assert.equal(reply.replyTo.mine, false)
    assert.equal(reply.replyTo.preview, 'Which film would you watch again?')
    const asMan = (await list(man, id)).find((m) => m.id === reply.id)
    assert.equal(asMan.replyTo.mine, true)
    assert.equal(asMan.mine, false)
  })

  it('refuses a reply to something that is not in this chat', async () => {
    const a = await pair(), b = await pair()
    const other = await j(await send(b.man, b.id, 'A message in a different chat'))
    assert.equal((await send(a.man, a.id, 'hello', other.id)).status, 400)
    assert.equal((await send(a.man, a.id, 'hello', 'no-such-id')).status, 400)
  })
})

describe('editing a message', () => {
  it('lets the sender edit their own text, and the other person sees it marked edited', async () => {
    const { man, woman, id } = await pair()
    const m = await j(await send(man, id, 'Helo there'))
    assert.equal(m.editedAt, null)
    const r = await edit(man, id, m.id, 'Hello there')
    assert.equal(r.status, 200)
    const edited = await j(r)
    assert.equal(edited.body, 'Hello there')
    assert.ok(edited.editedAt > 0)
    const seen = (await list(woman, id)).find((x) => x.id === m.id)
    assert.equal(seen.body, 'Hello there')
    assert.ok(seen.editedAt > 0)
  })

  it('refuses editing someone else\'s message, empty text, and unknown messages', async () => {
    const { man, woman, id } = await pair()
    const m = await j(await send(man, id, 'Mine'))
    assert.equal((await edit(woman, id, m.id, 'Hijacked')).status, 403)
    assert.equal((await edit(man, id, m.id, '   ')).status, 400)
    assert.equal((await edit(man, id, 'nope', 'x')).status, 404)
    assert.equal((await list(man, id)).find((x) => x.id === m.id).body, 'Mine')
  })

  it('closes the edit window after 15 minutes', async () => {
    const { man, id } = await pair()
    const m = await j(await send(man, id, 'Old message'))
    const db = new DatabaseSync(dbPath)
    db.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run(Date.now() - 16 * 60_000, m.id)
    db.close()
    const r = await edit(man, id, m.id, 'Too late')
    assert.equal(r.status, 409)
    assert.equal((await j(r)).error, 'edit_window_closed')
  })

  it('stops a blocked member from editing', async () => {
    const { man, woman, id } = await pair()
    const m = await j(await send(man, id, 'Before the block'))
    assert.equal((await call('POST', '/blocks', { token: woman.token, json: { memberId: man.memberId } })).status < 300, true)
    assert.ok((await edit(man, id, m.id, 'After the block')).status >= 400)
  })
})
