import { DatabaseSync } from 'node:sqlite'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'

export const db = new DatabaseSync(process.env.DB_PATH ?? 'connectly.db')
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    bump_id TEXT NOT NULL UNIQUE,
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
const userCols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name)
if (!userCols.includes('role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'")
if (!userCols.includes('membership_expires_at')) db.exec('ALTER TABLE users ADD COLUMN membership_expires_at INTEGER')
if (!userCols.includes('token_version')) db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0')
if (!userCols.includes('gender')) db.exec('ALTER TABLE users ADD COLUMN gender TEXT')
if (!userCols.includes('request_credits')) db.exec('ALTER TABLE users ADD COLUMN request_credits INTEGER NOT NULL DEFAULT 0')
if (!userCols.includes('rejection_reason')) db.exec('ALTER TABLE users ADD COLUMN rejection_reason TEXT')
if (!userCols.includes('city')) db.exec("ALTER TABLE users ADD COLUMN city TEXT NOT NULL DEFAULT ''")
if (!userCols.includes('looking_for')) db.exec("ALTER TABLE users ADD COLUMN looking_for TEXT NOT NULL DEFAULT ''")
if (!userCols.includes('terms_agreed_at')) db.exec('ALTER TABLE users ADD COLUMN terms_agreed_at INTEGER')

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

/** User status lifecycle: unverified -> pending -> active | rejected (-> pending again on resubmit). */
export type UserStatus = 'unverified' | 'pending' | 'active' | 'rejected'

export type UserRow = {
  id: string
  bump_id: string
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
  looking_for: string
  terms_agreed_at: number | null
  token_version: number
  created_at: number
}

export const newId = () => randomUUID()
export const newBumpId = () => randomBytes(4).toString('hex').toUpperCase()

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
    bumpId: u.bump_id,
    name: u.name,
    age: u.age,
    bio: u.bio,
    interests: JSON.parse(u.interests) as string[],
    city: u.city ?? '',
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
  }
}
