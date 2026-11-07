import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as webpush from 'web-push'

const PORT_ON = 4600 + Math.floor(Math.random() * 50)
const PORT_OFF = PORT_ON + 50
const vapid = webpush.generateVAPIDKeys()
let dir: string
const procs: ChildProcess[] = []

const KEYS = { p256dh: 'B' + 'a'.repeat(86), auth: 'a'.repeat(22) }
const endpointFor = (n: number | string) => `https://updates.push.example.com/send/${n}`

function startServer(port: number, name: string, extraEnv: Record<string, string>) {
  const proc = spawn(process.execPath, ['src/server.ts'], {
    env: {
      ...process.env, PORT: String(port), DB_PATH: path.join(dir, `${name}.db`), UPLOAD_DIR: path.join(dir, `${name}-up`),
      VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_SUBJECT: '', ...extraEnv,
    },
    stdio: 'ignore',
  })
  procs.push(proc)
  return (async () => {
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error('server did not start')
  })()
}

const client = (port: number) => {
  const base = `http://127.0.0.1:${port}/v0`
  const call = (method: string, url: string, opts: { token?: string; json?: unknown } = {}) => {
    const headers: Record<string, string> = {}
    if (opts.token) headers.authorization = `Bearer ${opts.token}`
    if (opts.json !== undefined) headers['content-type'] = 'application/json'
    return fetch(base + url, { method, headers, body: opts.json === undefined ? undefined : JSON.stringify(opts.json) })
  }
  const signup = async (email: string) => {
    const r = await call('POST', '/signup', { json: { email, password: 'Tr0ub4dor&3xKq', name: 'Test', age: 30 } })
    assert.equal(r.status, 200)
    return ((await r.json()) as { token: string }).token
  }
  return { call, signup }
}

const on = client(PORT_ON)
const off = client(PORT_OFF)

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'connectly-push-'))
  await Promise.all([
    startServer(PORT_ON, 'on', { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'mailto:ops@example.com' }),
    startServer(PORT_OFF, 'off', {}),
  ])
})

after(async () => {
  for (const p of procs) p.kill()
  await rm(dir, { recursive: true, force: true })
})

describe('push configuration', () => {
  it('requires authentication on every endpoint', async () => {
    for (const [m, u] of [['GET', '/push/config'], ['POST', '/push/subscriptions'], ['DELETE', '/push/subscriptions']] as const) {
      const r = await on.call(m, u, { json: m === 'GET' ? undefined : {} })
      assert.equal(r.status, 401, `${m} ${u}`)
    }
  })

  it('reports the public key when VAPID is configured', async () => {
    const token = await on.signup('cfg-on@x.test')
    const r = await on.call('GET', '/push/config', { token })
    assert.equal(r.status, 200)
    assert.deepEqual(await r.json(), { enabled: true, publicKey: vapid.publicKey })
  })

  it('is disabled gracefully without VAPID: config says so and mutations return 503', async () => {
    const token = await off.signup('cfg-off@x.test')
    const cfg = await off.call('GET', '/push/config', { token })
    assert.deepEqual(await cfg.json(), { enabled: false, publicKey: null })
    const sub = await off.call('POST', '/push/subscriptions', { token, json: { endpoint: endpointFor(1), keys: KEYS } })
    assert.equal(sub.status, 503)
    assert.equal(((await sub.json()) as any).error, 'push_disabled')
    const del = await off.call('DELETE', '/push/subscriptions', { token, json: { all: true } })
    assert.equal(del.status, 503)
  })
})

describe('subscription validation', () => {
  let token: string
  before(async () => { token = await on.signup('val@x.test') })
  const post = (endpoint: unknown, keys: unknown = KEYS) => on.call('POST', '/push/subscriptions', { token, json: { endpoint, keys } })

  it('accepts a normal https push endpoint', async () => {
    assert.equal((await post(endpointFor('ok'))).status, 200)
  })

  it('rejects non-https schemes, credentials and custom ports', async () => {
    for (const e of ['http://updates.push.example.com/x', 'ftp://updates.push.example.com/x', 'javascript:alert(1)', 'not a url',
      'https://user:pw@updates.push.example.com/x', 'https://updates.push.example.com:8443/x']) {
      assert.equal((await post(e)).status, 400, e)
    }
  })

  it('rejects internal and private hosts (SSRF)', async () => {
    for (const e of ['https://localhost/x', 'https://foo.localhost/x', 'https://printer.local/x', 'https://intranet/x',
      'https://127.0.0.1/x', 'https://10.1.2.3/x', 'https://172.16.0.9/x', 'https://192.168.1.1/x', 'https://169.254.169.254/latest/meta-data',
      'https://2130706433/x', 'https://0x7f.1/x', 'https://[::1]/x', 'https://[fd00::1]/x', 'https://[fe80::1]/x', 'https://[::ffff:127.0.0.1]/x']) {
      assert.equal((await post(e)).status, 400, e)
    }
  })

  it('rejects over-long endpoints and malformed keys', async () => {
    assert.equal((await post(`https://updates.push.example.com/${'a'.repeat(2048)}`)).status, 400)
    assert.equal((await post(endpointFor('k1'), { p256dh: 'short', auth: KEYS.auth })).status, 400)
    assert.equal((await post(endpointFor('k2'), { p256dh: KEYS.p256dh, auth: 'has spaces and !!' + 'a'.repeat(10) })).status, 400)
    assert.equal((await post(endpointFor('k3'), null)).status, 400)
    assert.equal((await on.call('POST', '/push/subscriptions', { token, json: { keys: KEYS } })).status, 400)
  })
})

describe('subscription semantics', () => {
  it('upserts by endpoint and moves an endpoint to the latest registering user', async () => {
    const a = await on.signup('move-a@x.test')
    const b = await on.signup('move-b@x.test')
    const ep = endpointFor('shared-device')
    assert.equal((await on.call('POST', '/push/subscriptions', { token: a, json: { endpoint: ep, keys: KEYS } })).status, 200)
    assert.equal((await on.call('POST', '/push/subscriptions', { token: a, json: { endpoint: ep, keys: KEYS } })).status, 200)
    assert.equal((await on.call('POST', '/push/subscriptions', { token: b, json: { endpoint: ep, keys: KEYS } })).status, 200)
    // A can no longer remove it (it belongs to B); B can.
    const byA = await on.call('DELETE', '/push/subscriptions', { token: a, json: { endpoint: ep } })
    assert.equal(((await byA.json()) as any).removed, 0)
    const byB = await on.call('DELETE', '/push/subscriptions', { token: b, json: { endpoint: ep } })
    assert.equal(((await byB.json()) as any).removed, 1)
  })

  it('caps subscriptions per user at 10, dropping the oldest', async () => {
    const token = await on.signup('cap@x.test')
    for (let i = 0; i < 12; i++) {
      assert.equal((await on.call('POST', '/push/subscriptions', { token, json: { endpoint: endpointFor(`cap-${i}`), keys: KEYS } })).status, 200)
    }
    const removeOne = async (i: number) =>
      ((await (await on.call('DELETE', '/push/subscriptions', { token, json: { endpoint: endpointFor(`cap-${i}`) } })).json()) as any).removed as number
    assert.equal(await removeOne(0), 0)
    assert.equal(await removeOne(1), 0)
    for (let i = 2; i < 12; i++) assert.equal(await removeOne(i), 1, `cap-${i}`)
  })

  it('re-registering refreshes an endpoint so it survives the cap', async () => {
    const token = await on.signup('refresh@x.test')
    for (let i = 0; i < 10; i++) await on.call('POST', '/push/subscriptions', { token, json: { endpoint: endpointFor(`r-${i}`), keys: KEYS } })
    await on.call('POST', '/push/subscriptions', { token, json: { endpoint: endpointFor('r-0'), keys: KEYS } })
    await on.call('POST', '/push/subscriptions', { token, json: { endpoint: endpointFor('r-new'), keys: KEYS } })
    const gone = await on.call('DELETE', '/push/subscriptions', { token, json: { endpoint: endpointFor('r-1') } })
    assert.equal(((await gone.json()) as any).removed, 0)
    const kept = await on.call('DELETE', '/push/subscriptions', { token, json: { endpoint: endpointFor('r-0') } })
    assert.equal(((await kept.json()) as any).removed, 1)
  })

  it('delete is idempotent, supports {all:true}, only touches own rows, and validates its body', async () => {
    const a = await on.signup('del-a@x.test')
    const b = await on.signup('del-b@x.test')
    await on.call('POST', '/push/subscriptions', { token: a, json: { endpoint: endpointFor('a1'), keys: KEYS } })
    await on.call('POST', '/push/subscriptions', { token: a, json: { endpoint: endpointFor('a2'), keys: KEYS } })
    await on.call('POST', '/push/subscriptions', { token: b, json: { endpoint: endpointFor('b1'), keys: KEYS } })
    const unknown = await on.call('DELETE', '/push/subscriptions', { token: a, json: { endpoint: endpointFor('never') } })
    assert.equal(unknown.status, 200)
    const all = await on.call('DELETE', '/push/subscriptions', { token: a, json: { all: true } })
    assert.equal(((await all.json()) as any).removed, 2)
    const again = await on.call('DELETE', '/push/subscriptions', { token: a, json: { all: true } })
    assert.equal(((await again.json()) as any).removed, 0)
    const bStill = await on.call('DELETE', '/push/subscriptions', { token: b, json: { endpoint: endpointFor('b1') } })
    assert.equal(((await bStill.json()) as any).removed, 1)
    assert.equal((await on.call('DELETE', '/push/subscriptions', { token: a, json: { all: false } })).status, 400)
    assert.equal((await on.call('DELETE', '/push/subscriptions', { token: a, json: {} })).status, 400)
  })
})

describe('delivery (in-process, injected sender)', () => {
  let mod: typeof import('../src/features/push.ts')
  let dbmod: typeof import('../src/db.ts')
  let hooks: typeof import('../src/features/hooks.ts')
  const sent: Array<{ endpoint: string; payload: string }> = []
  const SECRET_TEXT = 'meet me at the secret place'

  const addUser = (name: string) => {
    const id = dbmod.newId()
    dbmod.db.prepare('INSERT INTO users (id,bump_id,email,password_hash,name,age,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, dbmod.newBumpId(), `${name}@d.test`, 'x', name, 30, Date.now())
    return id
  }
  const addSub = (userId: string, endpoint: string) =>
    dbmod.db.prepare('INSERT INTO push_subscriptions (id,user_id,endpoint,p256dh,auth,user_agent,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(dbmod.newId(), userId, endpoint, KEYS.p256dh, KEYS.auth, null, Date.now())
  const subCount = (userId: string) =>
    (dbmod.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').get(userId) as { n: number }).n
  const event = (recipientId: string, senderId: string) =>
    ({ connectionId: 'conn-123', senderId, recipientId, preview: SECRET_TEXT })

  before(async () => {
    process.env.DB_PATH = path.join(dir, 'unit.db')
    dbmod = await import('../src/db.ts')
    hooks = await import('../src/features/hooks.ts')
    mod = await import('../src/features/push.ts')
  })
  after(() => mod.setPushSender(null))

  it('sends a content-free payload to every subscription of an offline recipient', async () => {
    const sender = addUser('Sender Sam')
    const rcpt = addUser('Rita')
    addSub(rcpt, endpointFor('d1'))
    addSub(rcpt, endpointFor('d2'))
    sent.length = 0
    mod.setPushSender(async (t, payload) => { sent.push({ endpoint: t.endpoint, payload }) })
    await mod.deliverMessagePush(event(rcpt, sender))
    assert.deepEqual(sent.map((s) => s.endpoint).sort(), [endpointFor('d1'), endpointFor('d2')])
    const payload = JSON.parse(sent[0]!.payload)
    assert.deepEqual(payload, { title: 'New message', body: 'You have a new message', data: { url: '/connections/conn-123' } })
    for (const s of sent) {
      assert.ok(!s.payload.includes(SECRET_TEXT))
      assert.ok(!s.payload.includes('Sender Sam'))
    }
  })

  it('skips recipients with a live socket or without subscriptions', async () => {
    const sender = addUser('S2')
    const online = addUser('Online')
    const nosub = addUser('NoSub')
    addSub(online, endpointFor('on1'))
    sent.length = 0
    mod.setPushSender(async (t, payload) => { sent.push({ endpoint: t.endpoint, payload }) })
    hooks.sockets.set(online, new Set([{} as any]))
    await mod.deliverMessagePush(event(online, sender))
    await mod.deliverMessagePush(event(nosub, sender))
    assert.equal(sent.length, 0)
    hooks.sockets.delete(online)
    await mod.deliverMessagePush(event(online, sender))
    assert.equal(sent.length, 1)
  })

  it('prunes subscriptions the push service reports gone (404/410) and keeps the rest', async () => {
    const sender = addUser('S3')
    const rcpt = addUser('Prune')
    addSub(rcpt, endpointFor('gone-410'))
    addSub(rcpt, endpointFor('gone-404'))
    addSub(rcpt, endpointFor('flaky-500'))
    addSub(rcpt, endpointFor('fine'))
    mod.setPushSender(async (t) => {
      const status = t.endpoint.includes('410') ? 410 : t.endpoint.includes('404') ? 404 : t.endpoint.includes('500') ? 500 : 201
      if (status >= 400) throw Object.assign(new Error(`status ${status}`), { statusCode: status })
    })
    await mod.deliverMessagePush(event(rcpt, sender))
    assert.equal(subCount(rcpt), 2)
  })

  it('survives a throwing or hanging sender without rejecting', async () => {
    const sender = addUser('S4')
    const rcpt = addUser('Boom')
    addSub(rcpt, endpointFor('boom'))
    mod.setPushSender(() => { throw new Error('sync explosion') })
    await assert.doesNotReject(mod.deliverMessagePush(event(rcpt, sender)))
    mod.setPushSender(async () => { throw new Error('async explosion') })
    await assert.doesNotReject(mod.deliverMessagePush(event(rcpt, sender)))
    assert.equal(subCount(rcpt), 1)
  })

  it('does nothing when push is not configured and no sender is injected', async () => {
    const rcpt = addUser('Disabled')
    addSub(rcpt, endpointFor('disabled'))
    mod.setPushSender(null)
    await assert.doesNotReject(mod.deliverMessagePush(event(rcpt, rcpt)))
    assert.equal(subCount(rcpt), 1)
  })
})

describe('isSafePushEndpoint', () => {
  it('accepts public hostnames and public IP literals, rejects the rest', async () => {
    process.env.DB_PATH = path.join(dir, 'unit2.db')
    const { isSafePushEndpoint } = await import('../src/features/push.ts')
    for (const ok of ['https://fcm.googleapis.com/fcm/send/abc', 'https://web.push.apple.com/QL', 'https://8.8.8.8/x', 'https://[2606:4700::1111]/x']) {
      assert.equal(isSafePushEndpoint(ok), true, ok)
    }
    for (const bad of ['https://0.0.0.0/x', 'https://100.64.0.1/x', 'https://[::]/x', 'https://[::ffff:10.0.0.1]/x', 'https://metadata.google.internal/x',
      'https://localhost./x', 'https://LOCALHOST/x', 'https://x.home.arpa/x', 'https://224.0.0.1/x']) {
      assert.equal(isSafePushEndpoint(bad), false, bad)
    }
  })
})
