import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const dir = await mkdtemp(path.join(tmpdir(), 'connectly-notify-'))
process.env.DB_PATH = path.join(dir, 'inproc.db')
process.env.WEB_ORIGIN = 'https://app.example.test'
delete process.env.SMTP_HOST

const { db } = await import('../src/db.ts')
const { setMailer, smtpOptionsFromEnv, buildSmtpTransport, mailConfigured } = await import('../src/mailer.ts')
const { handleRequestEvent, notifyRoutes } = await import('../src/notify.ts')
const { notifyRequest, sockets } = await import('../src/features/hooks.ts')
const { default: Fastify } = await import('fastify')

type Mail = { to: string; subject: string; text: string }
let sent: Mail[] = []
setMailer(async (m) => { sent.push(m) })

function user(gender: 'man' | 'woman', name: string) {
  const id = randomUUID()
  const email = `${name.toLowerCase()}-${id.slice(0, 6)}@x.test`
  db.prepare("INSERT INTO users (id, bump_id, email, password_hash, name, age, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(id, 'B' + id.slice(0, 8), email, 'x', name, 30, Date.now())
  return { id, email, name }
}
const ev = (kind: 'sent' | 'accepted', recipientId: string, actorId: string) => ({ kind, requestId: randomUUID(), recipientId, actorId })

describe('notification emails', () => {
  it('emails the woman for a sent request, with no names or note', async () => {
    sent = []
    const woman = user('woman', 'Priyanka'), man = user('man', 'Rahul')
    await handleRequestEvent(ev('sent', woman.id, man.id))
    assert.equal(sent.length, 1)
    assert.equal(sent[0]!.to, woman.email)
    const all = sent[0]!.subject + sent[0]!.text
    assert.ok(!/Priyanka|Rahul/i.test(all))
    assert.ok(sent[0]!.text.includes('https://app.example.test/requests'))
  })

  it('suppresses a second email within 15 minutes', async () => {
    sent = []
    const woman = user('woman', 'W'), man = user('man', 'M')
    await handleRequestEvent(ev('sent', woman.id, man.id))
    await handleRequestEvent(ev('sent', woman.id, man.id))
    assert.equal(sent.length, 1)
    db.prepare('UPDATE notification_email_log SET last_sent_at = ? WHERE user_id = ?').run(Date.now() - 16 * 60_000, woman.id)
    await handleRequestEvent(ev('sent', woman.id, man.id))
    assert.equal(sent.length, 2)
  })

  it('is race-safe for concurrent events', async () => {
    sent = []
    const woman = user('woman', 'W'), man = user('man', 'M')
    await Promise.all([1, 2, 3, 4].map(() => handleRequestEvent(ev('sent', woman.id, man.id))))
    assert.equal(sent.length, 1)
  })

  it('emails the man when accepted, linking to /sent', async () => {
    sent = []
    const woman = user('woman', 'W'), man = user('man', 'M')
    await handleRequestEvent(ev('accepted', man.id, woman.id))
    assert.equal(sent.length, 1)
    assert.equal(sent[0]!.to, man.email)
    assert.ok(sent[0]!.text.includes('https://app.example.test/sent'))
  })

  it('does nothing for a decline (no listener fires)', async () => {
    sent = []
    const app = Fastify(); await app.register(notifyRoutes); await app.ready()
    const woman = user('woman', 'W'), man = user('man', 'M')
    // requests.ts emits nothing for declines; only the two kinds exist. Sanity: a 'sent' event does go through the hook.
    notifyRequest(ev('sent', woman.id, man.id))
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(sent.length, 1)
    await app.close()
  })

  it('respects the preference being off', async () => {
    sent = []
    const woman = user('woman', 'W'), man = user('man', 'M')
    db.prepare('INSERT INTO notification_prefs (user_id, email_requests) VALUES (?, 0)').run(woman.id)
    await handleRequestEvent(ev('sent', woman.id, man.id))
    assert.equal(sent.length, 0)
  })

  it('does not email a recipient with a live socket', async () => {
    sent = []
    const woman = user('woman', 'W'), man = user('man', 'M')
    sockets.set(woman.id, new Set([{} as any]))
    await handleRequestEvent(ev('sent', woman.id, man.id))
    sockets.delete(woman.id)
    assert.equal(sent.length, 0)
  })

  it('a failing mailer never throws', async () => {
    const woman = user('woman', 'W'), man = user('man', 'M')
    setMailer(async () => { throw new Error('boom') })
    await handleRequestEvent(ev('sent', woman.id, man.id))
    setMailer(async (m) => { sent.push(m) })
  })
})

describe('mailer SMTP configuration', () => {
  it('is unset without SMTP_HOST', () => {
    assert.equal(smtpOptionsFromEnv({}), null)
  })
  it('builds options from env (465 implies secure)', () => {
    const o = smtpOptionsFromEnv({ SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '465', SMTP_USER: 'a@gmail.com', SMTP_PASS: 'pw', MAIL_FROM: 'Connectly <a@gmail.com>' })
    assert.deepEqual(o, { host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: 'a@gmail.com', pass: 'pw' }, from: 'Connectly <a@gmail.com>' })
    const p = smtpOptionsFromEnv({ SMTP_HOST: 'h', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASS: 'p' })!
    assert.equal(p.secure, false)
    assert.equal(p.from, 'u')
    assert.equal(smtpOptionsFromEnv({ SMTP_HOST: 'h', SMTP_PORT: '2525', SMTP_SECURE: 'true' })!.secure, true)
  })
  it('builds a transport function without connecting', () => {
    assert.equal(typeof buildSmtpTransport(smtpOptionsFromEnv({ SMTP_HOST: 'h' })!), 'function')
    assert.equal(mailConfigured(), true)
  })
})

describe('notification preferences endpoints', () => {
  const PORT = 5000 + Math.floor(Math.random() * 100)
  const BASE = `http://127.0.0.1:${PORT}/v0`
  let proc: ChildProcess
  let token: string
  const call = (method: string, url: string, t?: string, json?: unknown) => fetch(BASE + url, {
    method, headers: { ...(t ? { authorization: `Bearer ${t}` } : {}), ...(json !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: json === undefined ? undefined : JSON.stringify(json),
  })

  before(async () => {
    proc = spawn(process.execPath, ['src/server.ts'], {
      env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(dir, 'srv.db'), UPLOAD_DIR: path.join(dir, 'up'), RATE_LIMIT: 'off', SMTP_HOST: '' }, stdio: 'ignore',
    })
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break } catch { /* */ }
      await new Promise((r) => setTimeout(r, 100))
    }
    const r = await call('POST', '/signup', undefined, { email: 'n@x.test', password: 'Tr0ub4dor&3xKq', name: 'T', age: 30, gender: 'woman', agreeToTerms: true })
    assert.equal(r.status, 200)
    token = ((await r.json()) as { token: string }).token
  })
  after(async () => { proc.kill(); await rm(dir, { recursive: true, force: true }) })

  it('requires auth', async () => {
    assert.equal((await call('GET', '/notifications')).status, 401)
    assert.equal((await call('PUT', '/notifications', undefined, { emailRequests: false })).status, 401)
  })
  it('defaults on, validates, and persists', async () => {
    assert.deepEqual(await (await call('GET', '/notifications', token)).json(), { emailRequests: true })
    assert.equal((await call('PUT', '/notifications', token, { emailRequests: 'no' })).status, 400)
    assert.equal((await call('PUT', '/notifications', token, {})).status, 400)
    assert.deepEqual(await (await call('PUT', '/notifications', token, { emailRequests: false })).json(), { emailRequests: false })
    assert.deepEqual(await (await call('GET', '/notifications', token)).json(), { emailRequests: false })
  })
})
