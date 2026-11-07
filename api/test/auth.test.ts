import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const PW = 'Tr0ub4dor&3xKq'
const PW2 = 'Corr3ct-Horse-Battery'

type Srv = { base: string; origin: string; dbPath: string; stop: () => Promise<void>; output: () => string }
const dirs: string[] = []

async function startServer(env: Record<string, string>, port: number): Promise<Srv> {
  const dir = await mkdtemp(path.join(tmpdir(), 'connectly-auth-'))
  dirs.push(dir)
  const dbPath = path.join(dir, 't.db')
  const proc: ChildProcess = spawn(process.execPath, ['src/server.ts'], {
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, UPLOAD_DIR: path.join(dir, 'up'), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  proc.stdout!.on('data', (d) => { out += d })
  proc.stderr!.on('data', (d) => { out += d })
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100))
    if (i === 59) throw new Error('server did not start:\n' + out)
  }
  return {
    base: `http://127.0.0.1:${port}/v0`, origin: `127.0.0.1:${port}`, dbPath, output: () => out,
    stop: async () => { proc.kill() },
  }
}

const post = (s: Srv, url: string, json?: unknown, token?: string) =>
  fetch(s.base + url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(json ?? {}),
  })
const get = (s: Srv, url: string, token?: string) => fetch(s.base + url, { headers: token ? { authorization: `Bearer ${token}` } : {} })

let n = 0
const email = () => `u${++n}-${Math.random().toString(36).slice(2, 8)}@x.test`
async function signup(s: Srv, e = email(), password = PW) {
  const r = await post(s, '/signup', { agreeToTerms: true, email: e, password, name: 'Test', age: 30, gender: 'man' })
  assert.equal(r.status, 200, 'signup')
  return { email: e, ...((await r.json()) as { token: string }) }
}
const login = (s: Srv, e: string, password: string) => post(s, '/login', { email: e, password })

/** Waits for the server to log a mail to `to`, returning each reset token it contained (oldest first). */
async function resetTokens(s: Srv, to: string, expected: number) {
  for (let i = 0; i < 40; i++) {
    const tokens = s.output().split('[mail] to=').slice(1)
      .filter((blk) => blk.startsWith(to + ' '))
      .map((blk) => /reset-password\?token=([A-Za-z0-9_-]+)/.exec(blk)?.[1])
      .filter((t): t is string => !!t)
    if (tokens.length >= expected) return tokens
    await new Promise((r) => setTimeout(r, 50))
  }
  return []
}

const closeCode = (ws: WebSocket) => new Promise<number>((resolve) => ws.addEventListener('close', (e) => resolve(e.code)))

let A: Srv // limits off: functional behaviour
let B: Srv // limits on: rate-limit behaviour
const base = 4700 + Math.floor(Math.random() * 90) * 2

before(async () => {
  A = await startServer({ RATE_LIMIT: 'off' }, base)
  B = await startServer({ RATE_LIMIT: 'on' }, base + 1)
})
after(async () => {
  await A.stop(); await B.stop()
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})

describe('password policy and headers', () => {
  it('rejects weak, common and short passwords but accepts a good one', async () => {
    for (const password of ['password123', 'Password1', 'aaaaaaaaaa', 'short1!']) {
      const r = await post(A, '/signup', { agreeToTerms: true, email: email(), password, name: 'T', age: 30, gender: 'man' })
      assert.equal(r.status, 400, password)
    }
    const r = await post(A, '/signup', { agreeToTerms: true, email: email(), password: 'password123', name: 'T', age: 30, gender: 'man' })
    assert.ok(JSON.stringify(await r.json()).includes('password_too_common'))
    await signup(A)
  })

  it('sends security headers', async () => {
    const r = await fetch(`http://${A.origin}/health`)
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(r.headers.get('x-frame-options'), 'DENY')
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer')
  })
})

describe('sign-in throttling', () => {
  it('locks an email+IP pair after repeated failures, even for the right password, without affecting others', async () => {
    const u = await signup(A)
    const other = await signup(A)
    for (let i = 0; i < 5; i++) assert.equal((await login(A, u.email, 'Wrong-Passw0rd!')).status, 401)
    const locked = await login(A, u.email, PW)
    assert.equal(locked.status, 429)
    assert.ok(Number(locked.headers.get('retry-after')) > 0)
    assert.equal(((await locked.json()) as any).error, 'too_many_attempts')
    assert.equal((await login(A, other.email, PW)).status, 200, 'other accounts are unaffected')
  })

  it('a success clears earlier failures', async () => {
    const u = await signup(A)
    for (let i = 0; i < 4; i++) await login(A, u.email, 'Wrong-Passw0rd!')
    assert.equal((await login(A, u.email, PW)).status, 200)
    for (let i = 0; i < 4; i++) assert.equal((await login(A, u.email, 'Wrong-Passw0rd!')).status, 401, 'counter restarted')
  })

  it('unknown emails get the same answer as wrong passwords', async () => {
    const r = await login(A, 'nobody@x.test', PW)
    assert.equal(r.status, 401)
    assert.deepEqual(await r.json(), { error: 'invalid_credentials' })
  })
})

describe('per-IP rate limits', () => {
  it('does not throttle ordinary signed-in requests (one route\'s limit must not leak onto the others)', async () => {
    const u = await signup(B)
    for (let i = 0; i < 25; i++) assert.equal((await get(B, '/me', u.token)).status, 200, `request ${i + 1}`)
    const r = await get(B, '/me', u.token)
    assert.equal(r.headers.get('x-ratelimit-limit'), null, '/me has no rate-limit headers')
  })
  it('limits sign-in requests per IP', async () => {
    let last = 0
    for (let i = 0; i < 21; i++) last = (await login(B, email(), PW)).status
    assert.equal(last, 429)
  })
  it('limits sign-ups per IP', async () => {
    let last = 0
    for (let i = 0; i < 11; i++) last = (await post(B, '/signup', { agreeToTerms: true, email: email(), password: PW, name: 'T', age: 30, gender: 'man' })).status
    assert.equal(last, 429)
  })
  it('limits forgot-password requests per IP', async () => {
    let last = 0
    for (let i = 0; i < 6; i++) last = (await post(B, '/password/forgot', { email: email() })).status
    assert.equal(last, 429)
  })
})

describe('session revocation', () => {
  it('changing the password signs out other sessions, keeps this one, and checks the current password', async () => {
    const u = await signup(A)
    const second = (await (await login(A, u.email, PW)).json()) as { token: string }

    let r = await post(A, '/password/change', { currentPassword: 'Wrong-Passw0rd!', newPassword: PW2 }, u.token)
    assert.equal(r.status, 403)
    assert.equal(((await r.json()) as any).error, 'wrong_password')
    assert.equal((await get(A, '/me', u.token)).status, 200, 'a wrong current password does not sign you out')
    assert.equal((await post(A, '/password/change', { currentPassword: PW, newPassword: 'password123' }, u.token)).status, 400)
    assert.equal(((await (await post(A, '/password/change', { currentPassword: PW, newPassword: PW }, u.token)).json()) as any).error, 'same_password')

    r = await post(A, '/password/change', { currentPassword: PW, newPassword: PW2 }, u.token)
    assert.equal(r.status, 200)
    const { token: fresh } = (await r.json()) as { token: string }
    assert.equal((await get(A, '/me', u.token)).status, 401, 'old token revoked')
    assert.equal((await get(A, '/me', second.token)).status, 401, 'other session revoked')
    assert.equal((await get(A, '/me', fresh)).status, 200, 'new token works')
    assert.equal((await login(A, u.email, PW)).status, 401)
    assert.equal((await login(A, u.email, PW2)).status, 200)
  })

  it('throttles guessing the current password', async () => {
    const u = await signup(A)
    for (let i = 0; i < 5; i++) assert.equal((await post(A, '/password/change', { currentPassword: 'Wrong-Passw0rd!', newPassword: PW2 }, u.token)).status, 403)
    assert.equal((await post(A, '/password/change', { currentPassword: PW, newPassword: PW2 }, u.token)).status, 429)
  })

  it('"sign out everywhere" revokes every token and closes live sockets', async () => {
    const u = await signup(A)
    const second = (await (await login(A, u.email, PW)).json()) as { token: string }
    const ws = new WebSocket(`ws://${A.origin}/v0/ws?token=${encodeURIComponent(u.token)}`)
    await new Promise<void>((res, rej) => { ws.addEventListener('open', () => res()); ws.addEventListener('error', () => rej(new Error('ws failed')), { once: true }) })
    const closed = closeCode(ws)
    assert.equal((await post(A, '/logout-all', {}, u.token)).status, 200)
    assert.equal(await closed, 4401)
    assert.equal((await get(A, '/me', u.token)).status, 401)
    assert.equal((await get(A, '/me', second.token)).status, 401)

    const ws2 = new WebSocket(`ws://${A.origin}/v0/ws?token=${encodeURIComponent(u.token)}`)
    assert.equal(await closeCode(ws2), 4401, 'a revoked token cannot open a socket')
    const fresh = (await (await login(A, u.email, PW)).json()) as { token: string }
    assert.equal((await get(A, '/me', fresh.token)).status, 200, 'signing in again works')
  })

  it('a purged account\'s token is refused', async () => {
    const u = await signup(A)
    const db = new DatabaseSync(A.dbPath)
    db.prepare("UPDATE users SET status = 'deleted' WHERE email = ?").run(u.email)
    db.close()
    assert.equal((await get(A, '/me', u.token)).status, 401)
  })
})

describe('forgot / reset password', () => {
  it('answers identically for known and unknown emails and only mails real accounts', async () => {
    const u = await signup(A)
    const known = await post(A, '/password/forgot', { email: u.email })
    const unknown = await post(A, '/password/forgot', { email: 'ghost@x.test' })
    assert.equal(known.status, 202)
    assert.equal(unknown.status, 202)
    assert.deepEqual(await known.json(), await unknown.json())
    assert.equal((await resetTokens(A, u.email, 1)).length, 1)
    await new Promise((r) => setTimeout(r, 200))
    assert.ok(!A.output().includes('[mail] to=ghost@x.test'))
  })

  it('resets the password once, signs out old sessions, and stores only a hash', async () => {
    const u = await signup(A)
    await post(A, '/password/forgot', { email: u.email })
    const [token] = await resetTokens(A, u.email, 1)
    assert.ok(token)

    const db = new DatabaseSync(A.dbPath, { readOnly: true })
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM password_resets WHERE token_hash = ?').get(token)!.c, 0, 'raw token is not stored')
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM password_resets').get()!.c >= 1, true)
    db.close()

    assert.equal((await post(A, '/password/reset', { token, newPassword: 'password123' })).status, 400, 'policy applies')
    assert.equal((await post(A, '/password/reset', { token: 'x'.repeat(43), newPassword: PW2 })).status, 400, 'unknown token')
    assert.equal((await post(A, '/password/reset', { token, newPassword: PW2 })).status, 200)
    assert.equal((await post(A, '/password/reset', { token, newPassword: PW2 })).status, 400, 'single use')
    assert.equal((await get(A, '/me', u.token)).status, 401, 'old session revoked')
    assert.equal((await login(A, u.email, PW)).status, 401)
    assert.equal((await login(A, u.email, PW2)).status, 200)
  })

  it('only the newest link works', async () => {
    const u = await signup(A)
    await post(A, '/password/forgot', { email: u.email })
    await post(A, '/password/forgot', { email: u.email })
    const tokens = await resetTokens(A, u.email, 2)
    assert.equal((await post(A, '/password/reset', { token: tokens[0]!, newPassword: PW2 })).status, 400)
    assert.equal((await post(A, '/password/reset', { token: tokens[1]!, newPassword: PW2 })).status, 200)
  })

  it('rejects an expired link', async () => {
    const u = await signup(A)
    await post(A, '/password/forgot', { email: u.email })
    const [token] = await resetTokens(A, u.email, 1)
    const db = new DatabaseSync(A.dbPath)
    db.prepare('UPDATE password_resets SET expires_at = ? WHERE user_id = (SELECT id FROM users WHERE email = ?)').run(Date.now() - 1000, u.email)
    db.close()
    assert.equal((await post(A, '/password/reset', { token: token!, newPassword: PW2 })).status, 400)
    assert.equal((await login(A, u.email, PW)).status, 200, 'password unchanged')
  })

  it('caps reset emails per address', async () => {
    const u = await signup(A)
    for (let i = 0; i < 7; i++) assert.equal((await post(A, '/password/forgot', { email: u.email })).status, 202)
    assert.equal((await resetTokens(A, u.email, 5)).length, 5)
    await new Promise((r) => setTimeout(r, 300))
    assert.equal((await resetTokens(A, u.email, 5)).length, 5, 'no more than five')
  })
})

describe('production configuration', () => {
  const exitCode = (env: Record<string, string>, waitMs = 5000) => new Promise<number | null>((resolve) => {
    const p = spawn(process.execPath, ['src/server.ts'], {
      env: { ...process.env, DB_PATH: ':memory:', PORT: String(base + 30), NODE_ENV: 'production', ...env }, stdio: 'ignore',
    })
    const t = setTimeout(() => { p.kill(); resolve(null) }, waitMs)
    p.on('exit', (c) => { clearTimeout(t); resolve(c) })
  })

  it('refuses to start without JWT_SECRET or WEB_ORIGIN', async () => {
    const secret = 'a'.repeat(48)
    assert.equal(await exitCode({ WEB_ORIGIN: 'https://app.example' }), 1)
    assert.equal(await exitCode({ JWT_SECRET: secret }), 1)
    // control: with both set the server stays up, so the failures above are due to the missing settings
    assert.equal(await exitCode({ JWT_SECRET: secret, WEB_ORIGIN: 'https://app.example' }, 1500), null)
  })
})
