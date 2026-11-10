import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const PORT = 5240 + Math.floor(Math.random() * 40)
const BASE = `http://127.0.0.1:${PORT}/v0`
const PW = 'Tr0ub4dor&3xKq'
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)])
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)])
let proc: ChildProcess
let dir: string
let admin: string
const dbFile = () => path.join(dir, 't.db')
const upDir = () => path.join(dir, 'up')

async function call(method: string, url: string, opts: { token?: string; json?: unknown; form?: FormData } = {}) {
  const headers: Record<string, string> = {}
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  let body: BodyInit | undefined
  if (opts.json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.json) }
  if (opts.form) body = opts.form
  return fetch(BASE + url, { method, headers, body })
}
const j = async (r: Response) => (await r.json()) as any
const A = (m: string, u: string, json?: unknown) => call(m, u, { token: admin, json })

let n = 0
async function signup(gender: 'man' | 'woman' = 'woman', email = `v${++n}-${Math.random().toString(36).slice(2, 7)}@x.test`) {
  const r = await call('POST', '/signup', { json: { email, password: PW, name: 'V', age: 30, gender, agreeToTerms: true } })
  assert.equal(r.status, 200)
  const b = await j(r)
  return { email, token: b.token as string, memberId: b.user.memberId as string }
}
async function submit(token: string) {
  const f = new FormData()
  f.set('selfie', new Blob([new Uint8Array(JPEG)], { type: 'image/jpeg' }), 'a.jpg')
  f.set('voice', new Blob([new Uint8Array(WEBM)], { type: 'audio/webm' }), 'v.webm')
  assert.equal((await call('POST', '/verification', { token, form: f })).status, 201)
}
const pendingOf = async (memberId: string) =>
  ((await j(await A('GET', '/admin/verifications'))) as any[]).find((x) => x.user.memberId === memberId)
// The uploads folder also has a `chat` subfolder (voice messages); only the verification files are counted here.
const filesNow = async () => (await readdir(upDir())).filter((f) => f !== 'chat').sort()

function start() {
  proc = spawn(process.execPath, ['src/server.ts'], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: dbFile(), UPLOAD_DIR: upDir(), ADMIN_EMAILS: 'admin@x.test', RATE_LIMIT: 'off' },
    stdio: 'ignore',
  })
}
async function ready() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('server did not start')
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'connectly-vclean-'))
  start()
  await ready()
  admin = (await signup('man', 'admin@x.test')).token
})
after(async () => { proc.kill(); await rm(dir, { recursive: true, force: true }) })

describe('verification files are deleted after the decision', () => {
  it('keeps the files while pending, and deletes both as soon as it is approved', async () => {
    const u = await signup()
    await submit(u.token)
    assert.equal((await filesNow()).length, 2)
    const v = await pendingOf(u.memberId)
    assert.equal(v.mediaDeleted, false)
    assert.equal((await A('GET', `/admin/verifications/${v.id}/selfie`)).status, 200, 'the reviewer can see them while pending')
    assert.equal((await A('GET', `/admin/verifications/${v.id}/voice`)).status, 200)

    assert.equal((await A('POST', `/admin/verifications/${v.id}/decision`, { decision: 'approve' })).status, 200)
    assert.deepEqual(await filesNow(), [], 'selfie and voice clip are gone from disk')
    const done = ((await j(await A('GET', '/admin/verifications?status=approved'))) as any[]).find((x) => x.id === v.id)
    assert.equal(done.status, 'approved')
    assert.equal(done.mediaDeleted, true)
    for (const kind of ['selfie', 'voice']) {
      const r = await A('GET', `/admin/verifications/${v.id}/${kind}`)
      assert.equal(r.status, 410)
      assert.equal((await j(r)).error, 'media_deleted')
    }
    // the member is verified and the decision is still on record
    assert.equal((await j(await call('GET', '/me', { token: u.token }))).status, 'active')
    const db = new DatabaseSync(dbFile())
    const row = db.prepare('SELECT status, reviewed_by, reviewed_at, selfie_file, voice_file, media_deleted_at FROM verifications WHERE id = ?').get(v.id) as any
    db.close()
    assert.equal(row.status, 'approved')
    assert.ok(row.reviewed_by && row.reviewed_at)
    assert.equal(row.selfie_file, '')
    assert.equal(row.voice_file, '')
    assert.ok(row.media_deleted_at > 0)
  })

  it('also deletes both files when the verification is rejected, and a resubmission works', async () => {
    const u = await signup()
    await submit(u.token)
    const v = await pendingOf(u.memberId)
    assert.equal((await A('POST', `/admin/verifications/${v.id}/decision`, { decision: 'reject', reason: 'Selfie is blurry' })).status, 200)
    assert.deepEqual(await filesNow(), [])
    assert.equal((await A('GET', `/admin/verifications/${v.id}/selfie`)).status, 410)
    assert.equal((await j(await call('GET', '/me', { token: u.token }))).rejectionReason, 'Selfie is blurry')
    await submit(u.token) // a fresh submission is stored and reviewable again
    assert.equal((await filesNow()).length, 2)
    const v2 = await pendingOf(u.memberId)
    assert.equal((await A('GET', `/admin/verifications/${v2.id}/selfie`)).status, 200)
    assert.equal((await A('POST', `/admin/verifications/${v2.id}/decision`, { decision: 'approve' })).status, 200)
    assert.deepEqual(await filesNow(), [])
  })

  it('does not touch another member\'s pending files', async () => {
    const a = await signup(); const b = await signup()
    await submit(a.token); await submit(b.token)
    const va = await pendingOf(a.memberId)
    assert.equal((await A('POST', `/admin/verifications/${va.id}/decision`, { decision: 'approve' })).status, 200)
    assert.equal((await filesNow()).length, 2, "b's two files are still there")
    const vb = await pendingOf(b.memberId)
    assert.equal((await A('GET', `/admin/verifications/${vb.id}/voice`)).status, 200)
    assert.equal((await A('POST', `/admin/verifications/${vb.id}/decision`, { decision: 'approve' })).status, 200)
    assert.deepEqual(await filesNow(), [])
  })

  it('removes leftovers on the next start (a failed delete, or files from before this rule)', async () => {
    const u = await signup()
    await submit(u.token)
    const v = await pendingOf(u.memberId)
    assert.equal((await A('POST', `/admin/verifications/${v.id}/decision`, { decision: 'approve' })).status, 200)
    // simulate a delete that did not happen: put the files back and clear the "deleted" mark
    await writeFile(path.join(upDir(), 'leftover-selfie.jpg'), JPEG)
    await writeFile(path.join(upDir(), 'leftover-voice.webm'), WEBM)
    const db = new DatabaseSync(dbFile())
    db.prepare("UPDATE verifications SET selfie_file = 'leftover-selfie.jpg', voice_file = 'leftover-voice.webm', media_deleted_at = NULL WHERE id = ?").run(v.id)
    db.close()
    assert.equal((await filesNow()).length, 2)

    proc.kill()
    await new Promise((r) => setTimeout(r, 300))
    start()
    await ready()
    // the sweep runs when the server starts
    for (let i = 0; i < 30 && (await filesNow()).length > 0; i++) await new Promise((r) => setTimeout(r, 100))
    assert.deepEqual(await filesNow(), [])
    assert.equal(existsSync(path.join(upDir(), 'leftover-selfie.jpg')), false)
    const d2 = new DatabaseSync(dbFile())
    const row = d2.prepare('SELECT media_deleted_at FROM verifications WHERE id = ?').get(v.id) as any
    d2.close()
    assert.ok(row.media_deleted_at > 0)
  })
})

describe('support contact settings', () => {
  const setSettings = async (patch: Record<string, unknown>) => {
    const cur = await j(await A('GET', '/admin/settings'))
    return A('PUT', '/admin/settings', { packs: cur.packs, payee: cur.payee, quickReasons: cur.quickReasons, ...patch })
  }
  it('are empty by default, public once set, validated, and clearable', async () => {
    assert.deepEqual(await j(await call('GET', '/public-config')), { inviteOnly: false, betaFree: false, betaCity: '', supportEmail: '', supportWhatsapp: '' })
    const ok = await setSettings({ supportEmail: ' help@example.com ', supportWhatsapp: '+91 98765 43210' })
    assert.equal(ok.status, 200)
    const s = await j(ok)
    assert.equal(s.supportEmail, 'help@example.com')
    assert.equal(s.supportWhatsapp, '+91 98765 43210')
    const pub = await j(await call('GET', '/public-config'))
    assert.equal(pub.supportEmail, 'help@example.com')
    assert.equal(pub.supportWhatsapp, '+91 98765 43210')
    for (const bad of [{ supportEmail: 'not-an-email' }, { supportEmail: 'a b@c.d' }, { supportWhatsapp: 'call me' }, { supportWhatsapp: '123' }, { supportWhatsapp: '+1234567890123456' }, { supportEmail: 'x'.repeat(101) }]) {
      assert.equal((await setSettings(bad)).status, 400, JSON.stringify(bad))
    }
    assert.equal((await j(await call('GET', '/public-config'))).supportEmail, 'help@example.com', 'a refused change changes nothing')
    assert.equal((await setSettings({ supportEmail: '', supportWhatsapp: '' })).status, 200)
    const cleared = await j(await call('GET', '/public-config'))
    assert.equal(cleared.supportEmail, '')
    assert.equal(cleared.supportWhatsapp, '')
  })
})
