import { DatabaseSync } from 'node:sqlite'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'

export const db = new DatabaseSync(process.env.DB_PATH ?? 'connectly.db')
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    age INTEGER NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    interests TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS actions (
    from_id TEXT NOT NULL REFERENCES users(id),
    to_id TEXT NOT NULL REFERENCES users(id),
    action TEXT NOT NULL CHECK (action IN ('like','skip')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (from_id, to_id)
  );
  CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    a_id TEXT NOT NULL REFERENCES users(id),
    b_id TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    UNIQUE (a_id, b_id)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES connections(id),
    sender_id TEXT NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_conn ON messages(connection_id, created_at);
  CREATE TABLE IF NOT EXISTS verifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    selfie_file TEXT NOT NULL,
    selfie_mime TEXT NOT NULL,
    voice_file TEXT NOT NULL,
    voice_mime TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    reason TEXT,
    reviewed_by TEXT REFERENCES users(id),
    created_at INTEGER NOT NULL,
    reviewed_at INTEGER
  );
  -- At most one open submission per user, enforced by the database (race-safe).
  CREATE UNIQUE INDEX IF NOT EXISTS one_pending_per_user ON verifications(user_id) WHERE status = 'pending';
  CREATE INDEX IF NOT EXISTS idx_verifications_status ON verifications(status, created_at);
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    plan_id TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    days INTEGER NOT NULL,
    reference TEXT NOT NULL,
    proof_file TEXT NOT NULL,
    proof_mime TEXT NOT NULL,
    proof_sha256 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    reason TEXT,
    reviewed_by TEXT REFERENCES users(id),
    created_at INTEGER NOT NULL,
    reviewed_at INTEGER
  );
  CREATE UNIQUE INDEX IF NOT EXISTS one_pending_payment_per_user ON payments(user_id) WHERE status = 'pending';
  -- A payment reference or screenshot can fund at most one non-rejected payment.
  CREATE UNIQUE INDEX IF NOT EXISTS payment_reference_unique ON payments(reference) WHERE status != 'rejected';
  CREATE UNIQUE INDEX IF NOT EXISTS payment_proof_unique ON payments(proof_sha256) WHERE status != 'rejected';
  CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status, created_at);
`)

// Additive migrations for databases created before verification existed.
// Older databases called the public member id column `bump_id`; rename it in place (data is untouched).
{
  const cols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name)
  if (cols.includes('bump_id') && !cols.includes('member_id')) db.exec('ALTER TABLE users RENAME COLUMN bump_id TO member_id')
}
// When a decided verification's selfie and voice clip were deleted from disk (see deleteDecidedVerificationMedia).
{
  const cols = (db.prepare('PRAGMA table_info(verifications)').all() as { name: string }[]).map((c) => c.name)
  if (!cols.includes('media_deleted_at')) db.exec('ALTER TABLE verifications ADD COLUMN media_deleted_at INTEGER')
}
// Refunds are recorded beside the payment (the status check on payments is left alone): running totals on the row plus a history table.
{
  const cols = (db.prepare('PRAGMA table_info(payments)').all() as { name: string }[]).map((c) => c.name)
  if (!cols.includes('refunded_paise')) db.exec('ALTER TABLE payments ADD COLUMN refunded_paise INTEGER NOT NULL DEFAULT 0')
  if (!cols.includes('refunded_credits')) db.exec('ALTER TABLE payments ADD COLUMN refunded_credits INTEGER NOT NULL DEFAULT 0')
  db.exec(`
    CREATE TABLE IF NOT EXISTS refunds (
      id TEXT PRIMARY KEY,
      payment_id TEXT NOT NULL REFERENCES payments(id),
      amount_paise INTEGER NOT NULL,
      credits INTEGER NOT NULL,
      note TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_refunds_payment ON refunds(payment_id, created_at);
  `)
}
const userCols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name)
if (!userCols.includes('role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'")
if (!userCols.includes('membership_expires_at')) db.exec('ALTER TABLE users ADD COLUMN membership_expires_at INTEGER')
if (!userCols.includes('token_version')) db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0')
if (!userCols.includes('gender')) db.exec('ALTER TABLE users ADD COLUMN gender TEXT')
if (!userCols.includes('request_credits')) db.exec('ALTER TABLE users ADD COLUMN request_credits INTEGER NOT NULL DEFAULT 0')
if (!userCols.includes('rejection_reason')) db.exec('ALTER TABLE users ADD COLUMN rejection_reason TEXT')
if (!userCols.includes('city')) db.exec("ALTER TABLE users ADD COLUMN city TEXT NOT NULL DEFAULT ''")
if (!userCols.includes('languages')) db.exec("ALTER TABLE users ADD COLUMN languages TEXT NOT NULL DEFAULT '[]'")
if (!userCols.includes('looking_for')) db.exec("ALTER TABLE users ADD COLUMN looking_for TEXT NOT NULL DEFAULT ''")
if (!userCols.includes('terms_agreed_at')) db.exec('ALTER TABLE users ADD COLUMN terms_agreed_at INTEGER')
if (!userCols.includes('invited_by')) db.exec('ALTER TABLE users ADD COLUMN invited_by TEXT')
if (!userCols.includes('beta_credits_granted')) db.exec('ALTER TABLE users ADD COLUMN beta_credits_granted INTEGER NOT NULL DEFAULT 0')
if (!userCols.includes('price_interest')) db.exec('ALTER TABLE users ADD COLUMN price_interest TEXT')

db.exec(`
  CREATE TABLE IF NOT EXISTS invite_codes (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL DEFAULT '',
    max_uses INTEGER NOT NULL DEFAULT 1,
    uses INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_activity (
    user_id TEXT NOT NULL,
    day TEXT NOT NULL,
    PRIMARY KEY (user_id, day)
  );
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS message_reads (
    connection_id TEXT NOT NULL REFERENCES connections(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    last_read_at INTEGER NOT NULL,
    PRIMARY KEY (connection_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS admin_audit (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    target_user_id TEXT REFERENCES users(id),
    detail TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit(target_user_id, created_at);
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

/** Records an admin action. Call inside the same transaction as the change it describes. */
export function audit(adminId: string, action: string, targetUserId: string | null, detail: Record<string, unknown> = {}) {
  db.prepare('INSERT INTO admin_audit (id,admin_id,action,target_user_id,detail,created_at) VALUES (?,?,?,?,?,?)')
    .run(newId(), adminId, action, targetUserId, JSON.stringify(detail), Date.now())
}

const payCols = (db.prepare('PRAGMA table_info(payments)').all() as { name: string }[]).map((c) => c.name)
if (!payCols.includes('credits')) db.exec('ALTER TABLE payments ADD COLUMN credits INTEGER NOT NULL DEFAULT 0')

db.exec(`
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
`)

const msgCols = (db.prepare('PRAGMA table_info(messages)').all() as { name: string }[]).map((c) => c.name)
if (!msgCols.includes('kind')) db.exec("ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'")
if (!msgCols.includes('attachment_file')) db.exec('ALTER TABLE messages ADD COLUMN attachment_file TEXT')
if (!msgCols.includes('attachment_mime')) db.exec('ALTER TABLE messages ADD COLUMN attachment_mime TEXT')
if (!msgCols.includes('attachment_duration_ms')) db.exec('ALTER TABLE messages ADD COLUMN attachment_duration_ms INTEGER')

// ---- tracking: events, attribution, campaigns, waitlist, launch tracker ----
if (!userCols.includes('source_kind')) {
  db.exec('ALTER TABLE users ADD COLUMN source_kind TEXT')
  db.exec('ALTER TABLE users ADD COLUMN source_ref TEXT')
  db.exec("UPDATE users SET source_kind = 'member', source_ref = invited_by WHERE invited_by IS NOT NULL")
  db.exec("UPDATE users SET source_kind = 'direct' WHERE source_kind IS NULL")
}
const inviteCols = (db.prepare('PRAGMA table_info(invite_codes)').all() as { name: string }[]).map((c) => c.name)
if (!inviteCols.includes('campaign_id')) db.exec('ALTER TABLE invite_codes ADD COLUMN campaign_id TEXT')

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    type TEXT NOT NULL,
    meta TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, created_at);
  CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id);
  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    topic TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    cost_paise INTEGER NOT NULL DEFAULT 0,
    posted_at TEXT,
    code TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS campaign_clicks (
    campaign_id TEXT NOT NULL,
    day TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (campaign_id, day)
  );
  CREATE TABLE IF NOT EXISTS waitlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    city TEXT NOT NULL DEFAULT '',
    gender TEXT,
    source TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS milestones (
    key TEXT PRIMARY KEY,
    done INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    done_at TEXT,
    by TEXT
  );
`)

/**
 * Appends to the event log. Never throws. meta must hold ids, kinds and counts only: never message text,
 * selfie/voice content, emails or names.
 */
export function track(type: string, userId: string | null, meta: Record<string, string | number | boolean | null> = {}) {
  try {
    db.prepare('INSERT INTO events (user_id,type,meta,created_at) VALUES (?,?,?,?)')
      .run(userId, type, JSON.stringify(meta), new Date().toISOString())
  } catch { /* analytics must never break a request */ }
}

/** Like track, but only the first time this user has this event type. */
export function trackOnce(type: string, userId: string, meta: Record<string, string | number | boolean | null> = {}) {
  try {
    if (db.prepare('SELECT 1 FROM events WHERE user_id = ? AND type = ? LIMIT 1').get(userId, type)) return
  } catch { return }
  track(type, userId, meta)
}

/** User status lifecycle: unverified -> pending -> active | rejected (-> pending again on resubmit). */
export type UserStatus = 'unverified' | 'pending' | 'active' | 'rejected'

export type UserRow = {
  id: string
  member_id: string
  email: string
  password_hash: string
  name: string
  age: number
  bio: string
  interests: string
  status: UserStatus
  role: 'user' | 'admin'
  rejection_reason: string | null
  membership_expires_at: number | null
  gender: 'man' | 'woman' | null
  request_credits: number
  city: string
  languages: string
  looking_for: string
  terms_agreed_at: number | null
  invited_by: string | null
  beta_credits_granted: number
  price_interest: string | null
  source_kind: 'campaign' | 'member' | 'batch' | 'direct' | null
  source_ref: string | null
  token_version: number
  created_at: number
}

export const newId = () => randomUUID()
export const newMemberId = () => randomBytes(4).toString('hex').toUpperCase()

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length)
  return timingSafeEqual(expected, actual)
}

/** Public shape of a user; never includes email or password hash. */
export function publicProfile(u: UserRow) {
  return {
    memberId: u.member_id,
    name: u.name,
    age: u.age,
    bio: u.bio,
    interests: JSON.parse(u.interests) as string[],
    city: u.city ?? '',
    languages: JSON.parse(u.languages ?? '[]') as string[],
    lookingFor: u.looking_for ?? '',
  }
}

/** Shape of the signed-in user's own record. */
export function selfProfile(u: UserRow) {
  return {
    ...publicProfile(u),
    email: u.email,
    status: u.status,
    role: u.role,
    rejectionReason: u.status === 'rejected' ? u.rejection_reason : null,
    gender: u.gender,
    requestCredits: u.request_credits,
    termsAgreed: u.terms_agreed_at != null,
    priceInterest: u.price_interest ?? null,
    // True while an admin suspension is in force, so the app can explain why sending is blocked.
    suspended: isSuspendedUser(u.id),
  }
}

function isSuspendedUser(userId: string): boolean {
  try { return !!db.prepare('SELECT 1 FROM suspensions WHERE user_id = ?').get(userId) } catch { return false }
}
