import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import path from 'node:path'

const PORT = 4500 + Math.floor(Math.random() * 100)
const BASE = `http://127.0.0.1:${PORT}/v0`
let proc: ChildProcess
let dir: string

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg-body-bytes'), Buffer.alloc(64, 7)])
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 9)])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(32, 3)])
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from('audio-body-bytes'), Buffer.alloc(200, 5)])
const MB = 1024 * 1024

async function call(method: string, url: string, opts: { token?: string; json?: unknown; form?: FormData; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...opts.headers }
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  let body: BodyInit | undefined
  if (opts.json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.json) }
  if (opts.form) body = opts.form
  return fetch(BASE + url, { method, headers, body })
}

type Account = { token: string; user: { bumpId: string } }

async function signup(email: string, name: string) {
  const r = await call('POST', '/signup', { json: { email, password: 'Tr0ub4dor&3xKq', name, age: 30 } })
  assert.equal(r.status, 200)
  return (await r.json()) as Account
}

function upload(file: Buffer, opts: { mime?: string; name?: string; durationMs?: string; field?: string } = {}) {
  const f = new FormData()
  if (opts.durationMs !== undefined) f.set('durationMs', opts.durationMs)
  f.set(opts.field ?? 'file', new Blob([new Uint8Array(file)], { type: opts.mime ?? 'application/octet-stream' }), opts.name ?? 'upload.bin')
  return f
}

const send = (token: string, conn: string, file: Buffer, opts?: Parameters<typeof upload>[1]) =>
  call('POST', `/connections/${conn}/attachments`, { token, form: upload(file, opts) })

/** Signs up a member and has the admin approve their verification. */
async function activeUser(admin: Account, email: string, name: string) {
  const u = await signup(email, name)
  const f = new FormData()
  f.set('selfie', new Blob([new Uint8Array(JPEG)]), 'a.jpg')
  f.set('voice', new Blob([new Uint8Array(WEBM)]), 'v.webm')
  assert.equal((await call('POST', '/verification', { token: u.token, form: f })).status, 201)
  const list = (await (await call('GET', '/admin/verifications', { token: admin.token })).json()) as any[]
  const item = list.find((x) => x.user.bumpId === u.user.bumpId)
  assert.equal((await call('POST', `/admin/verifications/${item.id}/decision`, { token: admin.token, json: { decision: 'approve' } })).status, 200)
  return u
}

async function connect(a: Account, b: Account) {
  await call('POST', '/actions', { token: a.token, json: { bumpId: b.user.bumpId, action: 'like' } })
  const r = (await (await call('POST', '/actions', { token: b.token, json: { bumpId: a.user.bumpId, action: 'like' } })).json()) as any
  assert.equal(r.matched, true)
  return r.connectionId as string
}

let admin: Account
let alice: Account // verified, no membership
let carol: Account // verified, outsider
let conn: string // admin <-> alice

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'connectly-att-'))
  proc = spawn(process.execPath, ['src/server.ts'], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(dir, 't.db'), UPLOAD_DIR: path.join(dir, 'up'), ADMIN_EMAILS: 'admin@att.test' },
    stdio: 'ignore',
  })
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100))
  }
  // Admins skip the membership requirement, so the admin is the sending member.
  admin = await signup('admin@att.test', 'Admin')
  alice = await activeUser(admin, 'alice@att.test', 'Alice')
  carol = await activeUser(admin, 'carol@att.test', 'Carol')
  conn = await connect(admin, alice)
})

after(async () => {
  proc.kill()
  await rm(dir, { recursive: true, force: true })
})

async function waitForFrame(ws: WebSocket) {
  return new Promise<any>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no frame')), 3000)
    ws.addEventListener('message', (e) => { clearTimeout(t); resolve(JSON.parse(String(e.data))) }, { once: true })
  })
}

describe('image attachments', () => {
  for (const [label, bytes, mime] of [['jpeg', JPEG, 'image/jpeg'], ['png', PNG, 'image/png'], ['webp', WEBP, 'image/webp']] as const) {
    it(`stores a ${label} and returns identical bytes to both participants`, async () => {
      // the claimed mime type and file name are lies; the bytes decide
      const r = await send(admin.token, conn, bytes, { mime: 'text/html', name: '../../evil.html' })
      assert.equal(r.status, 201)
      const msg = (await r.json()) as any
      assert.equal(msg.kind, 'image')
      assert.equal(msg.mine, true)
      assert.equal(msg.attachmentMime, mime)
      assert.equal(msg.body, '')

      for (const token of [admin.token, alice.token]) {
        const got = await call('GET', `/connections/${conn}/messages/${msg.id}/attachment`, { token })
        assert.equal(got.status, 200)
        assert.equal(got.headers.get('content-type'), mime)
        assert.equal(got.headers.get('x-content-type-options'), 'nosniff')
        assert.equal(got.headers.get('cache-control'), 'private, no-store')
        assert.equal(got.headers.get('content-security-policy'), "default-src 'none'; sandbox")
        assert.deepEqual(Buffer.from(await got.arrayBuffer()), bytes)
      }
    })
  }

  it('shows up in the message list with kind and mime, and never leaks the stored file name', async () => {
    const list = (await (await call('GET', `/connections/${conn}/messages`, { token: alice.token })).json()) as any[]
    const img = list.find((m) => m.kind === 'image')
    assert.ok(img)
    assert.equal(img.mine, false)
    assert.equal(img.attachmentMime, 'image/jpeg')
    assert.equal(img.attachmentDurationMs, null)
    assert.equal(JSON.stringify(list).includes('attachment_file'), false)
  })

  it('stores files under chat/ with generated names and mode 0600', async () => {
    const files = await readdir(path.join(dir, 'up', 'chat'))
    assert.ok(files.length >= 3)
    for (const f of files) {
      assert.match(f, /^[0-9a-f-]{36}\.(jpg|png|webp|webm)$/)
      assert.equal((await stat(path.join(dir, 'up', 'chat', f))).mode & 0o777, 0o600)
    }
    // the hostile client file name '../../evil.html' created nothing outside the upload dir
    assert.deepEqual((await readdir(dir)).filter((n) => n.includes('evil')), [])
  })

  it('rejects oversize images with 413 and nothing stored', async () => {
    const before = (await readdir(path.join(dir, 'up', 'chat'))).length
    const r = await send(admin.token, conn, Buffer.concat([JPEG, Buffer.alloc(5 * MB)]))
    assert.equal(r.status, 413)
    assert.equal((await readdir(path.join(dir, 'up', 'chat'))).length, before)
  })
})

describe('voice attachments', () => {
  it('stores audio with its duration and serves identical bytes', async () => {
    const r = await send(admin.token, conn, WEBM, { mime: 'audio/webm', durationMs: '4200' })
    assert.equal(r.status, 201)
    const msg = (await r.json()) as any
    assert.equal(msg.kind, 'voice')
    assert.equal(msg.attachmentMime, 'audio/webm')
    assert.equal(msg.attachmentDurationMs, 4200)
    const got = await call('GET', `/connections/${conn}/messages/${msg.id}/attachment`, { token: alice.token })
    assert.deepEqual(Buffer.from(await got.arrayBuffer()), WEBM)

    const list = (await (await call('GET', `/connections/${conn}/messages`, { token: alice.token })).json()) as any[]
    const v = list.find((m) => m.id === msg.id)
    assert.equal(v.kind, 'voice')
    assert.equal(v.attachmentDurationMs, 4200)
  })

  it('serves byte ranges for seeking', async () => {
    const msg = (await (await send(admin.token, conn, WEBM, { durationMs: '1000' })).json()) as any
    const url = `/connections/${conn}/messages/${msg.id}/attachment`
    let r = await call('GET', url, { token: alice.token, headers: { range: 'bytes=10-19' } })
    assert.equal(r.status, 206)
    assert.equal(r.headers.get('content-range'), `bytes 10-19/${WEBM.length}`)
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), WEBM.subarray(10, 20))
    r = await call('GET', url, { token: alice.token, headers: { range: 'bytes=-8' } })
    assert.equal(r.status, 206)
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), WEBM.subarray(WEBM.length - 8))
    r = await call('GET', url, { token: alice.token, headers: { range: `bytes=${WEBM.length}-` } })
    assert.equal(r.status, 416)
    assert.equal(r.headers.get('content-range'), `bytes */${WEBM.length}`)
  })

  it('requires a duration between 1 and 120000 ms', async () => {
    for (const durationMs of [undefined, '', '0', '-5', '120001', 'abc', '1.5']) {
      const r = await send(admin.token, conn, WEBM, durationMs === undefined ? {} : { durationMs })
      assert.equal(r.status, 400, `duration ${durationMs}`)
    }
    assert.equal((await send(admin.token, conn, WEBM, { durationMs: '120000' })).status, 201)
  })

  it('rejects oversize audio with 413', async () => {
    assert.equal((await send(admin.token, conn, Buffer.concat([WEBM, Buffer.alloc(5 * MB)]), { durationMs: '1000' })).status, 413)
  })
})

describe('validation', () => {
  it('415 for content that is neither image nor audio, whatever the client claims', async () => {
    let r = await send(admin.token, conn, Buffer.from('<html><script>alert(1)</script></html>'), { mime: 'image/jpeg', name: 'x.jpg' })
    assert.equal(r.status, 415)
    r = await send(admin.token, conn, Buffer.from('MZ\x90\x00 pretend exe'), { mime: 'audio/webm', durationMs: '1000' })
    assert.equal(r.status, 415)
    r = await send(admin.token, conn, Buffer.alloc(0))
    assert.equal(r.status, 415)
  })

  it('400 for wrong field names, extra files, extra fields and non-multipart bodies', async () => {
    assert.equal((await send(admin.token, conn, JPEG, { field: 'photo' })).status, 400)
    const two = upload(JPEG)
    two.set('second', new Blob([new Uint8Array(JPEG)]), 'b.jpg')
    assert.equal((await call('POST', `/connections/${conn}/attachments`, { token: admin.token, form: two })).status, 400)
    const fields = upload(WEBM, { durationMs: '1000' })
    fields.set('extra', 'x')
    assert.equal((await call('POST', `/connections/${conn}/attachments`, { token: admin.token, form: fields })).status, 400)
    assert.equal((await call('POST', `/connections/${conn}/attachments`, { token: admin.token, json: {} })).status, 415)
    assert.equal((await call('POST', `/connections/${conn}/attachments`, { token: admin.token, form: new FormData() })).status, 400)
  })

  it('requires authentication and verification', async () => {
    assert.equal((await call('POST', `/connections/${conn}/attachments`, { form: upload(JPEG) })).status, 401)
    const unverified = await signup('unv@att.test', 'Unv')
    assert.equal((await send(unverified.token, conn, JPEG)).status, 403)
  })
})

describe('authorization', () => {
  let msgId: string
  before(async () => {
    msgId = ((await (await send(admin.token, conn, JPEG)).json()) as any).id
  })

  it('non-participants get 404 for upload, download and quota', async () => {
    assert.equal((await send(carol.token, conn, JPEG)).status, 404)
    assert.equal((await call('GET', `/connections/${conn}/messages/${msgId}/attachment`, { token: carol.token })).status, 404)
    assert.equal((await call('GET', `/connections/${conn}/attachments/quota`, { token: carol.token })).status, 404)
    assert.equal((await call('GET', `/connections/${conn}/messages/${msgId}/attachment`)).status, 401)
  })

  it('unknown connection, unknown message and text messages give 404', async () => {
    assert.equal((await send(admin.token, '00000000-0000-0000-0000-000000000000', JPEG)).status, 404)
    assert.equal((await call('GET', `/connections/${conn}/messages/nope/attachment`, { token: admin.token })).status, 404)
    const text = (await (await call('POST', `/connections/${conn}/messages`, { token: admin.token, json: { body: 'hi' } })).json()) as any
    assert.equal((await call('GET', `/connections/${conn}/messages/${text.id}/attachment`, { token: alice.token })).status, 404)
  })

  it("a message id from another connection can't be fetched through this one", async () => {
    const dave = await activeUser(admin, 'dave@att.test', 'Dave')
    const other = await connect(admin, dave)
    assert.equal((await call('GET', `/connections/${other}/messages/${msgId}/attachment`, { token: admin.token })).status, 404)
  })

  it('a member without a membership gets 402 and nothing is stored', async () => {
    const before = (await readdir(path.join(dir, 'up', 'chat'))).length
    const r = await send(alice.token, conn, JPEG)
    assert.equal(r.status, 402)
    assert.equal(((await r.json()) as any).error, 'membership_required')
    assert.equal((await readdir(path.join(dir, 'up', 'chat'))).length, before)
    // reading stays free
    assert.equal((await call('GET', `/connections/${conn}/messages/${msgId}/attachment`, { token: alice.token })).status, 200)
  })
})

describe('image quota', () => {
  it('allows 20 photos per sender per connection per day, then 429; voice is unaffected', async () => {
    const erin = await activeUser(admin, 'erin@att.test', 'Erin')
    const c = await connect(admin, erin)
    let quota = (await (await call('GET', `/connections/${c}/attachments/quota`, { token: admin.token })).json()) as any
    assert.deepEqual(quota, { imagesRemaining: 20, resetsAt: null })

    for (let i = 0; i < 20; i++) assert.equal((await send(admin.token, c, JPEG)).status, 201, `photo ${i + 1}`)
    const before = (await readdir(path.join(dir, 'up', 'chat'))).length
    const r = await send(admin.token, c, JPEG)
    assert.equal(r.status, 429)
    assert.equal(((await r.json()) as any).error, 'image_quota_exceeded')
    assert.equal((await readdir(path.join(dir, 'up', 'chat'))).length, before, 'rejected upload leaves no file')

    quota = (await (await call('GET', `/connections/${c}/attachments/quota`, { token: admin.token })).json()) as any
    assert.equal(quota.imagesRemaining, 0)
    assert.ok(Math.abs(quota.resetsAt - (Date.now() + 24 * 3600 * 1000)) < 60_000)

    assert.equal((await send(admin.token, c, WEBM, { durationMs: '1000' })).status, 201)
    // the quota is per connection
    assert.equal((await send(admin.token, conn, JPEG)).status, 201)
  })
})

describe('path safety', () => {
  it('refuses stored paths that escape the chat directory', async () => {
    await writeFile(path.join(dir, 'secret.txt'), 'top secret')
    const msgId = ((await (await send(admin.token, conn, JPEG)).json()) as any).id
    const sqlite = new DatabaseSync(path.join(dir, 't.db'))
    sqlite.exec('PRAGMA busy_timeout = 5000')
    try {
      for (const evil of ['../secret.txt', 'chat/../../secret.txt', '../up-evil/x', '/etc/hosts', 'chat']) {
        sqlite.prepare('UPDATE messages SET attachment_file=? WHERE id=?').run(evil, msgId)
        const r = await call('GET', `/connections/${conn}/messages/${msgId}/attachment`, { token: admin.token })
        assert.equal(r.status, 404, evil)
      }
    } finally {
      sqlite.close()
    }
  })
})

describe('realtime delivery', () => {
  it('pushes the new message to the other participant only', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/v0/ws?token=${alice.token}`)
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
    await new Promise((r) => setTimeout(r, 100))
    const senderWs = new WebSocket(`ws://127.0.0.1:${PORT}/v0/ws?token=${admin.token}`)
    await new Promise((resolve) => senderWs.addEventListener('open', resolve, { once: true }))
    await new Promise((r) => setTimeout(r, 100))

    const frame = waitForFrame(ws)
    const sent = (await (await send(admin.token, conn, WEBM, { durationMs: '2500' })).json()) as any
    const got = await frame
    assert.equal(got.type, 'message')
    assert.equal(got.connectionId, conn)
    assert.deepEqual(got.message, {
      id: sent.id, mine: false, kind: 'voice', body: '', attachmentMime: 'audio/webm', attachmentDurationMs: 2500, createdAt: sent.createdAt,
    })
    // the sender is not pushed their own message
    const echoed = await Promise.race([waitForFrame(senderWs), new Promise((r) => setTimeout(() => r('none'), 300))])
    assert.equal(echoed, 'none')
    ws.close()
    senderWs.close()
  })
})
