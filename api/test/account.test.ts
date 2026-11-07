import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const PORT = 4400 + Math.floor(Math.random() * 100)
const BASE = `http://127.0.0.1:${PORT}/v0`
const DAY = 24 * 60 * 60 * 1000
let proc: ChildProcess
let dir: string
let upload: string
// The test process opens the same database file (WAL) for setup and assertions, and runs the purge in-process.
let db: typeof import('../src/db.ts').db
let purge: typeof import('../src/scripts/purge-deleted-accounts.ts').purgeDueAccounts

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)])
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)])
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)])

async function call(method: string, url: string, opts: { token?: string; json?: unknown; form?: FormData } = {}) {
  const headers: Record<string, string> = {}
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  let body: BodyInit | undefined
  if (opts.json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.json) }
  if (opts.form) body = opts.form
  return fetch(BASE + url, { method, headers, body })
}

type User = { token: string; bumpId: string; id: string; email: string }
let counter = 0

async function signup(name: string): Promise<User> {
  const email = `acct${++counter}-${Math.random().toString(36).slice(2, 8)}@x.test`
  const r = await call('POST', '/signup', { json: { email, password: 'Tr0ub4dor&3xKq', name, age: 30 } })
  assert.equal(r.status, 200)
  const j = (await r.json()) as { token: string; user: { bumpId: string } }
  const row = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }
  return { token: j.token, bumpId: j.user.bumpId, id: row.id, email }
}

const form = (parts: Record<string, [Buffer, string]>) => {
  const f = new FormData()
  for (const [k, [buf, type]] of Object.entries(parts)) f.set(k, new Blob([new Uint8Array(buf)], { type }), k)
  return f
}

/** Verified member with a live membership (so they may chat). */
async function member(name: string): Promise<User> {
  const u = await signup(name)
  assert.equal((await call('POST', '/verification', { token: u.token, form: form({ selfie: [JPEG, 'image/jpeg'], voice: [WEBM, 'audio/webm'] }) })).status, 201)
  const login = await (await call('POST', '/login', { json: { email: 'admin@x.test', password: 'Tr0ub4dor&3xKq' } })).json() as any
  const list = (await (await call('GET', '/admin/verifications', { token: login.token })).json()) as any[]
  const item = list.find((x) => x.user.bumpId === u.bumpId)
  assert.equal((await call('POST', `/admin/verifications/${item.id}/decision`, { token: login.token, json: { decision: 'approve' } })).status, 200)
  db.prepare('UPDATE users SET membership_expires_at = ? WHERE id = ?').run(Date.now() + 30 * DAY, u.id)
  return u
}

async function connect(a: User, b: User): Promise<string> {
  await call('POST', '/actions', { token: a.token, json: { bumpId: b.bumpId, action: 'like' } })
  const r = await call('POST', '/actions', { token: b.token, json: { bumpId: a.bumpId, action: 'like' } })
  const j = (await r.json()) as { matched: boolean; connectionId: string }
  assert.equal(j.matched, true)
  return j.connectionId
}

const wallNames = async (u: User) => ((await (await call('GET', '/profiles', { token: u.token })).json()) as any[]).map((p) => p.bumpId as string)
const connectionIds = async (u: User) => ((await (await call('GET', '/connections', { token: u.token })).json()) as any[]).map((c) => c.profile.bumpId as string)
const account = async (u: User) => (await (await call('GET', '/account', { token: u.token })).json()) as any
const send = (u: User, connId: string) => call('POST', `/connections/${connId}/messages`, { token: u.token, json: { body: 'hello' } })

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'connectly-account-'))
  upload = path.join(dir, 'up')
  proc = spawn(process.execPath, ['src/server.ts'], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(dir, 't.db'), UPLOAD_DIR: upload, ADMIN_EMAILS: 'admin@x.test' },
    stdio: 'ignore',
  })
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100))
  }
  process.env.DB_PATH = path.join(dir, 't.db')
  process.env.UPLOAD_DIR = upload
  db = (await import('../src/db.ts')).db
  db.exec('PRAGMA busy_timeout = 5000')
  purge = (await import('../src/scripts/purge-deleted-accounts.ts')).purgeDueAccounts
  const r = await call('POST', '/signup', { json: { email: 'admin@x.test', password: 'Tr0ub4dor&3xKq', name: 'Admin', age: 40 } })
  assert.equal(r.status, 200)
})

after(async () => {
  proc.kill()
  await rm(dir, { recursive: true, force: true })
})

describe('authorization', () => {
  it('requires a signed-in user on every endpoint', async () => {
    for (const [m, u] of [
      ['GET', '/account'], ['POST', '/account/quiet-mode'], ['DELETE', '/account/quiet-mode'],
      ['POST', '/account/deactivate'], ['DELETE', '/account/deactivate'],
      ['POST', '/account/delete-request'], ['DELETE', '/account/delete-request'],
    ] as const) {
      assert.equal((await call(m, u)).status, 401, `${m} ${u}`)
      assert.equal((await call(m, u, { token: 'garbage' })).status, 401, `${m} ${u} bad token`)
    }
  })

  it('lets an unverified member manage their own account', async () => {
    const u = await signup('Unverified')
    assert.deepEqual(await account(u), { quietUntil: null, deactivated: false, deleteRequestedAt: null, deletionDueAt: null })
    assert.equal((await call('POST', '/account/deactivate', { token: u.token })).status, 200)
    assert.equal((await account(u)).deactivated, true)
  })

  it('never lets a member affect another member', async () => {
    const a = await member('A')
    const b = await member('B')
    await call('POST', '/account/deactivate', { token: a.token })
    assert.equal((await account(b)).deactivated, false)
  })
})

describe('quiet mode', () => {
  it('validates the duration', async () => {
    const u = await signup('Q')
    for (const hours of [0, -1, 721, 1.5, '3', null]) {
      assert.equal((await call('POST', '/account/quiet-mode', { token: u.token, json: { hours } })).status, 400, String(hours))
    }
    assert.equal((await account(u)).quietUntil, null)
  })

  it('hides the member from other walls only, and is idempotent', async () => {
    const quiet = await member('Quiet')
    const other = await member('Other')
    const friend = await member('Friend')
    const connId = await connect(quiet, friend)
    assert.ok((await wallNames(other)).includes(quiet.bumpId))

    const before = Date.now()
    let r = await call('POST', '/account/quiet-mode', { token: quiet.token, json: { hours: 2 } })
    assert.equal(r.status, 200)
    const s = (await r.json()) as any
    assert.ok(s.quietUntil >= before + 2 * 3600_000 && s.quietUntil <= Date.now() + 2 * 3600_000)
    assert.equal(s.deactivated, false)

    assert.ok(!(await wallNames(other)).includes(quiet.bumpId), 'hidden from wall')
    assert.ok((await wallNames(quiet)).includes(other.bumpId), 'can still browse')
    assert.ok((await connectionIds(friend)).includes(quiet.bumpId), 'connections unaffected')
    assert.equal((await send(quiet, connId)).status, 200, 'can chat')
    assert.equal((await send(friend, connId)).status, 200, 'can be chatted with')

    // Turning off twice is fine.
    for (let i = 0; i < 2; i++) {
      r = await call('DELETE', '/account/quiet-mode', { token: quiet.token })
      assert.equal(r.status, 200)
      assert.equal(((await r.json()) as any).quietUntil, null)
    }
    assert.ok((await wallNames(other)).includes(quiet.bumpId), 'visible again')
  })

  it('without hours lasts until turned off', async () => {
    const quiet = await member('Forever')
    const other = await member('Watcher')
    const s = await (await call('POST', '/account/quiet-mode', { token: quiet.token })).json() as any
    assert.equal(s.quietUntil, 8_640_000_000_000_000)
    assert.ok(!(await wallNames(other)).includes(quiet.bumpId))
    await call('DELETE', '/account/quiet-mode', { token: quiet.token })
    assert.ok((await wallNames(other)).includes(quiet.bumpId))
  })

  it('expires on read without any timer', async () => {
    const quiet = await member('Expiring')
    const other = await member('Watcher2')
    await call('POST', '/account/quiet-mode', { token: quiet.token, json: { hours: 1 } })
    assert.ok(!(await wallNames(other)).includes(quiet.bumpId))
    db.prepare('UPDATE account_state SET quiet_until = ? WHERE user_id = ?').run(Date.now() - 1000, quiet.id)
    assert.equal((await account(quiet)).quietUntil, null)
    assert.ok((await wallNames(other)).includes(quiet.bumpId))
  })

  it('refuses likes and skips aimed at a quiet member, but not from one', async () => {
    const quiet = await member('QuietTarget')
    const other = await member('Liker')
    await call('POST', '/account/quiet-mode', { token: quiet.token, json: { hours: 5 } })
    for (const action of ['like', 'skip']) {
      const r = await call('POST', '/actions', { token: other.token, json: { bumpId: quiet.bumpId, action } })
      assert.equal(r.status, 404)
      assert.equal(((await r.json()) as any).error, 'not_found')
    }
    assert.equal((await call('POST', '/actions', { token: quiet.token, json: { bumpId: other.bumpId, action: 'like' } })).status, 200)
  })
})

describe('deactivation', () => {
  it('hides from wall and connections and blocks likes and messages in both directions', async () => {
    const gone = await member('Gone')
    const friend = await member('Friend2')
    const stranger = await member('Stranger')
    const connId = await connect(gone, friend)
    assert.ok((await connectionIds(friend)).includes(gone.bumpId))

    assert.equal((await call('POST', '/account/deactivate', { token: gone.token })).status, 200)
    const first = await account(gone)
    assert.equal(first.deactivated, true)
    // Idempotent
    assert.deepEqual(await (await call('POST', '/account/deactivate', { token: gone.token })).json(), first)

    assert.ok(!(await wallNames(stranger)).includes(gone.bumpId))
    assert.ok(!(await connectionIds(friend)).includes(gone.bumpId))

    let r = await call('POST', '/actions', { token: gone.token, json: { bumpId: stranger.bumpId, action: 'like' } })
    assert.equal(r.status, 403)
    assert.equal(((await r.json()) as any).error, 'account_deactivated')
    r = await send(gone, connId)
    assert.equal(r.status, 403)
    assert.equal(((await r.json()) as any).error, 'account_deactivated')
    r = await call('POST', '/actions', { token: stranger.token, json: { bumpId: gone.bumpId, action: 'like' } })
    assert.equal(r.status, 404)
    r = await send(friend, connId)
    assert.equal(r.status, 404)
    assert.equal(((await r.json()) as any).error, 'not_found')

    // Still able to log in, read their data and see their own history.
    assert.equal((await call('GET', '/me', { token: gone.token })).status, 200)
    assert.equal((await call('GET', `/connections/${connId}/messages`, { token: gone.token })).status, 200)
    assert.ok((await wallNames(gone)).includes(stranger.bumpId))
  })

  it('reactivation restores everything and is idempotent', async () => {
    const u = await member('Back')
    const friend = await member('Friend3')
    const connId = await connect(u, friend)
    await call('POST', '/account/deactivate', { token: u.token })
    for (let i = 0; i < 2; i++) {
      const r = await call('DELETE', '/account/deactivate', { token: u.token })
      assert.equal(r.status, 200)
      assert.equal(((await r.json()) as any).deactivated, false)
    }
    assert.ok((await wallNames(await member('Newcomer'))).includes(u.bumpId))
    assert.ok((await connectionIds(friend)).includes(u.bumpId))
    assert.equal((await send(u, connId)).status, 200)
  })
})

describe('delete request', () => {
  it('validates the reason', async () => {
    const u = await signup('Reason')
    assert.equal((await call('POST', '/account/delete-request', { token: u.token, json: { reason: 'x'.repeat(301) } })).status, 400)
    assert.equal((await call('POST', '/account/delete-request', { token: u.token, json: { reason: 5 } })).status, 400)
    assert.equal((await account(u)).deleteRequestedAt, null)
  })

  it('starts a 30-day grace period, deactivates, and never deletes over HTTP', async () => {
    const u = await member('Leaving')
    const other = await member('Stays')
    const before = Date.now()
    const r = await call('POST', '/account/delete-request', { token: u.token, json: { reason: '  moving on  ' } })
    assert.equal(r.status, 200)
    const s = (await r.json()) as any
    assert.ok(s.deleteRequestedAt >= before && s.deleteRequestedAt <= Date.now())
    assert.equal(s.deletionDueAt, s.deleteRequestedAt + 30 * DAY)
    assert.equal(s.deactivated, true)
    assert.ok(!(await wallNames(other)).includes(u.bumpId))
    const row = db.prepare('SELECT delete_reason FROM account_state WHERE user_id = ?').get(u.id) as any
    assert.equal(row.delete_reason, 'moving on')
    const user = db.prepare('SELECT email, name FROM users WHERE id = ?').get(u.id) as any
    assert.equal(user.email, u.email, 'data untouched')
    assert.equal(((await (await call('GET', '/me', { token: u.token })).json()) as any).name, 'Leaving')

    // A repeat keeps the original start time and reason.
    const again = (await (await call('POST', '/account/delete-request', { token: u.token, json: { reason: 'different' } })).json()) as any
    assert.deepEqual(again, s)
    assert.equal((db.prepare('SELECT delete_reason FROM account_state WHERE user_id = ?').get(u.id) as any).delete_reason, 'moving on')

    // Cannot reactivate on its own while the request is pending.
    const re = await call('DELETE', '/account/deactivate', { token: u.token })
    assert.equal(re.status, 409)
    assert.equal(((await re.json()) as any).error, 'deletion_pending')
    assert.equal((await account(u)).deactivated, true)
  })

  it('cancel clears the request and reactivates only a request-made deactivation', async () => {
    const u = await member('Cancels')
    const other = await member('Sees')
    await call('POST', '/account/delete-request', { token: u.token, json: {} })
    for (let i = 0; i < 2; i++) {
      const r = await call('DELETE', '/account/delete-request', { token: u.token })
      assert.equal(r.status, 200)
      assert.deepEqual(await r.json(), { quietUntil: null, deactivated: false, deleteRequestedAt: null, deletionDueAt: null })
    }
    assert.ok((await wallNames(other)).includes(u.bumpId))
    assert.equal((db.prepare('SELECT delete_reason FROM account_state WHERE user_id = ?').get(u.id) as any).delete_reason, null)

    const v = await member('PreDeactivated')
    await call('POST', '/account/deactivate', { token: v.token })
    await new Promise((r) => setTimeout(r, 5))
    await call('POST', '/account/delete-request', { token: v.token })
    const s = (await (await call('DELETE', '/account/delete-request', { token: v.token })).json()) as any
    assert.equal(s.deleteRequestedAt, null)
    assert.equal(s.deactivated, true, 'earlier deactivation is kept')
    assert.equal((await call('DELETE', '/account/deactivate', { token: v.token })).status, 200)
  })
})

describe('purge-deleted-accounts', () => {
  const upFile = (name: string) => path.join(upload, name)
  const requestDeletion = (u: User, daysAgo: number) => {
    db.prepare('INSERT INTO account_state (user_id, deactivated_at, delete_requested_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET deactivated_at = excluded.deactivated_at, delete_requested_at = excluded.delete_requested_at')
      .run(u.id, Date.now() - daysAgo * DAY, Date.now() - daysAgo * DAY)
  }

  it('anonymises only accounts past the grace period and honours --dry-run', async () => {
    const due = await member('DueMember')
    const notDue = await member('NotDue')
    const friend = await member('Chatter')
    const connId = await connect(due, friend)
    assert.equal((await send(friend, connId)).status, 200)
    assert.equal((await call('POST', '/account/quiet-mode', { token: due.token })).status, 200)

    // Files: verification selfie/voice (from signup), a payment proof, a message attachment.
    const pf = form({ proof: [PNG, 'image/png'] }); pf.set('planId', 'monthly'); pf.set('reference', `UTR${Date.now()}`)
    assert.equal((await call('POST', '/payments', { token: due.token, form: pf })).status, 201)
    const attach = `${crypto.randomUUID()}.png`
    await writeFile(upFile(attach), PNG)
    db.prepare("INSERT INTO messages (id, connection_id, sender_id, body, kind, attachment_file, attachment_mime, created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(crypto.randomUUID(), connId, due.id, 'secret caption', 'image', attach, 'image/png', Date.now())
    const owned = [
      ...(db.prepare('SELECT selfie_file AS f FROM verifications WHERE user_id = ? UNION ALL SELECT voice_file FROM verifications WHERE user_id = ?').all(due.id, due.id) as any[]),
      ...(db.prepare('SELECT proof_file AS f FROM payments WHERE user_id = ?').all(due.id) as any[]),
    ].map((r) => r.f as string)
    owned.push(attach)
    assert.equal(owned.length, 4)
    for (const f of owned) assert.ok(existsSync(upFile(f)), f)
    const notDueFile = (db.prepare('SELECT selfie_file AS f FROM verifications WHERE user_id = ?').get(notDue.id) as any).f as string

    // Rows in optional feature tables (names match what the script looks for).
    db.exec(`
      CREATE TABLE IF NOT EXISTS test_blocklist (blocker_id TEXT NOT NULL REFERENCES users(id), blocked_id TEXT NOT NULL REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS test_reports (id TEXT PRIMARY KEY, reporter_id TEXT REFERENCES users(id), reported_id TEXT REFERENCES users(id), reviewed_by TEXT REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS test_push_subs (user_id TEXT NOT NULL REFERENCES users(id), endpoint TEXT NOT NULL);
    `)
    const admin = (db.prepare("SELECT id FROM users WHERE email = 'admin@x.test'").get() as any).id as string
    db.prepare('INSERT INTO test_blocklist VALUES (?,?)').run(due.id, friend.id)
    db.prepare('INSERT INTO test_blocklist VALUES (?,?)').run(friend.id, due.id)
    db.prepare('INSERT INTO test_blocklist VALUES (?,?)').run(friend.id, notDue.id)
    db.prepare('INSERT INTO test_reports VALUES (?,?,?,?)').run('r1', friend.id, due.id, admin)
    db.prepare('INSERT INTO test_reports VALUES (?,?,?,?)').run('r2', admin, friend.id, due.id)
    db.prepare('INSERT INTO test_push_subs VALUES (?,?)').run(due.id, 'https://push.example/x')
    db.prepare('INSERT INTO test_push_subs VALUES (?,?)').run(friend.id, 'https://push.example/y')

    requestDeletion(due, 31)
    requestDeletion(notDue, 29)

    // Dry run reports but changes nothing.
    assert.deepEqual(await purge({ dryRun: true }), { due: 1, purged: 0, failed: 0, filesRemoved: 4 })
    assert.equal((db.prepare('SELECT name FROM users WHERE id = ?').get(due.id) as any).name, 'DueMember')
    for (const f of owned) assert.ok(existsSync(upFile(f)), `dry run kept ${f}`)

    const result = await purge({})
    assert.deepEqual(result, { due: 1, purged: 1, failed: 0, filesRemoved: 4 })

    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(due.id) as any
    assert.equal(row.name, 'Deleted member')
    assert.equal(row.email, `deleted-${due.id}@deleted.invalid`)
    assert.equal(row.bio, '')
    assert.equal(row.interests, '[]')
    assert.equal(row.status, 'deleted')
    assert.equal(row.membership_expires_at, null)
    for (const f of owned) assert.ok(!existsSync(upFile(f)), `removed ${f}`)
    assert.ok(existsSync(upFile(notDueFile)), 'other accounts keep their files')
    assert.equal((db.prepare('SELECT name FROM users WHERE id = ?').get(notDue.id) as any).name, 'NotDue')

    // Cannot log in, and an old token is useless.
    assert.equal((await call('POST', '/login', { json: { email: due.email, password: 'Tr0ub4dor&3xKq' } })).status, 401)
    assert.equal((await call('POST', '/login', { json: { email: row.email, password: '!' } })).status, 401)
    assert.equal((await call('GET', '/profiles', { token: due.token })).status, 401)
    assert.equal((await call('GET', '/account', { token: due.token })).status, 401)
    assert.equal((await call('DELETE', '/account/delete-request', { token: due.token })).status, 401)
    assert.equal((await call('POST', '/verification', { token: due.token, form: form({ selfie: [JPEG, 'image/jpeg'], voice: [WEBM, 'audio/webm'] }) })).status, 401)
    assert.ok(!(await wallNames(friend)).includes(due.bumpId))

    // Referential integrity: rows kept, content gone, other tables cleaned.
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM connections WHERE id = ?').get(connId) as any).n, 1)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM payments WHERE user_id = ?').get(due.id) as any).n, 1)
    const mine = db.prepare('SELECT body, kind, attachment_file FROM messages WHERE sender_id = ?').all(due.id) as any[]
    assert.ok(mine.every((m) => m.body === '' && m.kind === 'text' && m.attachment_file === null))
    const theirs = db.prepare('SELECT body FROM messages WHERE sender_id = ?').all(friend.id) as any[]
    assert.ok(theirs.some((m) => m.body === 'hello'), "other member's messages untouched")
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM actions WHERE from_id = ? OR to_id = ?').get(due.id, due.id) as any).n, 0)
    assert.deepEqual(db.prepare('SELECT blocker_id, blocked_id FROM test_blocklist').all().map((r: any) => [r.blocker_id, r.blocked_id]), [[friend.id, notDue.id]])
    assert.deepEqual(db.prepare('SELECT id FROM test_reports ORDER BY id').all().map((r: any) => r.id), ['r2'], 'rows reviewed by the member belong to the reporter')
    assert.deepEqual(db.prepare('SELECT user_id FROM test_push_subs').all().map((r: any) => r.user_id), [friend.id])

    // Re-running does nothing, and the not-yet-due account is still waiting.
    assert.deepEqual(await purge({}), { due: 0, purged: 0, failed: 0, filesRemoved: 0 })
    assert.equal((await account(notDue)).deleteRequestedAt !== null, true)
  })

  it('a cancelled request is never purged', async () => {
    const u = await member('Changed mind')
    requestDeletion(u, 40)
    assert.equal((await call('DELETE', '/account/delete-request', { token: u.token })).status, 200)
    assert.deepEqual(await purge({}), { due: 0, purged: 0, failed: 0, filesRemoved: 0 })
    assert.equal((db.prepare('SELECT name FROM users WHERE id = ?').get(u.id) as any).name, 'Changed mind')
  })

  it('runs from the command line', async () => {
    const u = await signup('CliDue')
    requestDeletion(u, 45)
    const run = (...args: string[]) => new Promise<{ code: number | null; out: string }>((resolve) => {
      const p = spawn(process.execPath, ['src/scripts/purge-deleted-accounts.ts', ...args], {
        env: { ...process.env, DB_PATH: path.join(dir, 't.db'), UPLOAD_DIR: upload },
      })
      let out = ''
      p.stdout.on('data', (d) => { out += d })
      p.on('close', (code) => resolve({ code, out }))
    })
    let r = await run('--dry-run')
    assert.equal(r.code, 0)
    assert.match(r.out, /\[dry run\] 1 account/)
    assert.equal((db.prepare('SELECT name FROM users WHERE id = ?').get(u.id) as any).name, 'CliDue')
    assert.equal((await run('--bogus')).code, 2)
    r = await run()
    assert.equal(r.code, 0)
    assert.match(r.out, /1 account\(s\) due: 1 anonymised/)
    assert.equal((db.prepare('SELECT name FROM users WHERE id = ?').get(u.id) as any).name, 'Deleted member')
  })
})
