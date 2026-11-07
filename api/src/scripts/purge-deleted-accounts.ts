/**
 * Anonymises accounts whose 30-day deletion grace period has elapsed.
 * Usage: node src/scripts/purge-deleted-accounts.ts [--dry-run]
 *
 * The users row is kept (payments, messages and connections reference it) but stripped of personal data and
 * made unusable: the password hash can never verify and the status 'deleted' fails every status check.
 * Existing JWTs are stateless, so those checks (plus the 401 on /v0/account) are what end old sessions.
 */
import path from 'node:path'
import { db } from '../db.ts'
import { UPLOAD_DIR, removeQuietly, tx } from '../verification.ts'
import { GRACE_MS } from '../features/account.ts'

export type PurgeResult = { due: number; purged: number; failed: number; filesRemoved: number }

// Tables created by other features. Matched by name so the script works whichever of them exist.
const RELATED_TABLE = /block|report|preference|push|request/
// Moderator columns point at the *reviewing* admin; those rows belong to someone else and stay.
const REVIEWER_COLUMNS = new Set(['reviewed_by', 'resolved_by', 'decided_by', 'handled_by'])
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Columns (table, column) holding a user id in the optional feature tables that exist in this database. */
function relatedColumns(): Array<{ table: string; column: string }> {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
    .map((t) => t.name)
    .filter((n) => IDENT.test(n) && RELATED_TABLE.test(n) && n !== 'account_state')
  const found: Array<{ table: string; column: string }> = []
  for (const table of tables) {
    const refersToUsers = new Set(
      (db.prepare(`PRAGMA foreign_key_list(${table})`).all() as { from: string; table: string }[])
        .filter((fk) => fk.table === 'users').map((fk) => fk.from),
    )
    for (const col of db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]) {
      if (!IDENT.test(col.name) || REVIEWER_COLUMNS.has(col.name)) continue
      if (refersToUsers.has(col.name) || col.name === 'user_id') found.push({ table, column: col.name })
    }
  }
  return found
}

type Due = { id: string; bump_id: string }

const selectDue = (cutoff: number) => db.prepare(`
  SELECT u.id, u.bump_id FROM account_state s JOIN users u ON u.id = s.user_id
  WHERE s.delete_requested_at IS NOT NULL AND s.delete_requested_at <= ? AND s.purged_at IS NULL
  ORDER BY s.delete_requested_at
`).all(cutoff) as Due[]

function uploadedFiles(userId: string): string[] {
  const names = [
    ...(db.prepare('SELECT selfie_file AS f FROM verifications WHERE user_id = ? UNION ALL SELECT voice_file FROM verifications WHERE user_id = ?').all(userId, userId) as { f: string }[]),
    ...(db.prepare('SELECT proof_file AS f FROM payments WHERE user_id = ?').all(userId) as { f: string }[]),
    ...(db.prepare('SELECT attachment_file AS f FROM messages WHERE sender_id = ? AND attachment_file IS NOT NULL').all(userId) as { f: string }[]),
  ].map((r) => r.f)
  // Stored names are server-generated; refuse anything that could point outside UPLOAD_DIR.
  return names.filter((f) => f && f === path.basename(f))
}

function anonymise(userId: string, cutoff: number, related: ReturnType<typeof relatedColumns>): string[] | null {
  return tx(() => {
    // Re-check inside the transaction so a cancellation that raced the script wins.
    if (!selectDue(cutoff).some((d) => d.id === userId)) return null
    const files = uploadedFiles(userId)
    db.prepare("UPDATE users SET name = 'Deleted member', email = ?, password_hash = '!', age = 18, bio = '', interests = '[]', status = 'deleted', role = 'user', rejection_reason = NULL, membership_expires_at = NULL WHERE id = ?")
      .run(`deleted-${userId}@deleted.invalid`, userId)
    // Close open review queues so an admin cannot approve something for a deleted member.
    for (const table of ['verifications', 'payments']) {
      db.prepare(`UPDATE ${table} SET status = 'rejected', reason = 'account_deleted', reviewed_at = ? WHERE user_id = ? AND status = 'pending'`).run(Date.now(), userId)
    }
    db.prepare('DELETE FROM actions WHERE from_id = ? OR to_id = ?').run(userId, userId)
    // Their messages stay in the other member's history, without content or media.
    db.prepare("UPDATE messages SET body = '', kind = 'text', attachment_file = NULL, attachment_mime = NULL, attachment_duration_ms = NULL WHERE sender_id = ?").run(userId)
    for (const { table, column } of related) db.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).run(userId)
    db.prepare('UPDATE account_state SET quiet_until = NULL, delete_reason = NULL, purged_at = ? WHERE user_id = ?').run(Date.now(), userId)
    return files
  })
}

export async function purgeDueAccounts({ dryRun = false }: { dryRun?: boolean } = {}): Promise<PurgeResult> {
  const cutoff = Date.now() - GRACE_MS
  const due = selectDue(cutoff)
  const result: PurgeResult = { due: due.length, purged: 0, failed: 0, filesRemoved: 0 }
  if (dryRun) {
    for (const d of due) result.filesRemoved += uploadedFiles(d.id).length
    return result
  }
  const related = relatedColumns()
  for (const d of due) {
    try {
      const files = anonymise(d.id, cutoff, related)
      if (files === null) continue
      await removeQuietly(...files)
      result.purged++
      result.filesRemoved += files.length
    } catch (e) {
      result.failed++
      console.error(`failed to purge ${d.bump_id}:`, e instanceof Error ? e.message : e)
    }
  }
  return result
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  if (args.some((a) => a !== '--dry-run')) {
    console.error('usage: node src/scripts/purge-deleted-accounts.ts [--dry-run]')
    process.exit(2)
  }
  const dryRun = args.includes('--dry-run')
  const r = await purgeDueAccounts({ dryRun })
  console.log(dryRun
    ? `[dry run] ${r.due} account(s) due, ${r.filesRemoved} file(s) would be removed (${UPLOAD_DIR}). Nothing changed.`
    : `${r.due} account(s) due: ${r.purged} anonymised, ${r.failed} failed, ${r.filesRemoved} file(s) removed.`)
  process.exit(r.failed > 0 ? 1 : 0)
}
