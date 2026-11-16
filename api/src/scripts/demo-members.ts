/**
 * Adds, or removes, a small set of clearly marked demo members so the community, filters, skip and request flows can be tried.
 *
 * Usage (run from the api folder, on the server or on any copy of the database):
 *   node src/scripts/demo-members.ts add [--dry-run]
 *   node src/scripts/demo-members.ts remove [--dry-run]
 *
 * Every demo member has an email ending in @demo.invalid and a random password nobody knows, so nobody can log in as them.
 * They are verified women, so real verified men can see them: remove them before you open to real members.
 * `remove` also deletes every request, skip, chat and message that involves a demo member.
 */
import { randomBytes } from 'node:crypto'
import { db, hashPassword, newId, newMemberId, TERMS_VERSION } from '../db.ts'

const DOMAIN = '@demo.invalid'
const DEMO = [
  ['Chitra', 24, 'Hyderabad', ['Telugu', 'English'], ['Films', 'Cooking'], 'Junior designer who watches too many old films. Happy to swap recommendations.'],
  ['Divya', 31, 'Bangalore', ['Kannada', 'English'], ['Trekking', 'Music'], 'Weekend trekker and terrible singer. Looking for good conversation.'],
  ['Esha', 27, 'Hyderabad', ['Hindi', 'English'], ['Books', 'Travel'], 'Reader, planner of trips I rarely take. Ask me about my last book.'],
  ['Farah', 35, 'Mumbai', ['Hindi', 'Urdu'], ['Art', 'Dance'], 'Painter and part-time dancer. I like people who ask questions.'],
  ['Gauri', 29, 'Pune', ['Marathi', 'English'], ['Cooking', 'Photography'], 'I cook on Sundays and photograph what I cook. Tea over coffee.'],
  ['Hema', 26, 'Chennai', ['Tamil', 'English'], ['Music', 'Films'], 'Carnatic student who also loves 90s film songs.'],
  ['Ira', 33, 'Delhi', ['Hindi', 'English'], ['Books', 'Fitness'], 'Early runner, slow reader. Looking for kind, curious people.'],
  ['Jaya', 30, 'Visakhapatnam', ['Telugu', 'Hindi', 'English'], ['Travel', 'Cricket'], 'Beach walks, cricket scores and street food.'],
  ['Kavya', 25, 'Kochi', ['Malayalam', 'English'], ['Dance', 'Photography'], 'Dance teacher by evening, photographer on weekends.'],
  ['Leela', 38, 'Kolkata', ['Bengali', 'Hindi', 'English'], ['Books', 'Art'], 'Editor. Believes a good letter beats a hundred messages.'],
  ['Meera', 28, 'Hyderabad', ['Telugu', 'Hindi'], ['Gaming', 'Cooking'], 'Gamer, baker, and proud owner of a very opinionated cat.'],
  ['Nisha', 32, 'Ahmedabad', ['Gujarati', 'Hindi', 'English'], ['Travel', 'Fitness'], 'Yoga in the morning, road trips whenever possible.'],
] as const

const dry = process.argv.includes('--dry-run')
const cmd = process.argv[2]
const demoIds = () => (db.prepare('SELECT id FROM users WHERE email LIKE ?').all(`%${DOMAIN}`) as { id: string }[]).map((r) => r.id)

function add() {
  const existing = new Set((db.prepare('SELECT email FROM users WHERE email LIKE ?').all(`%${DOMAIN}`) as { email: string }[]).map((r) => r.email))
  let added = 0
  const ins = db.prepare(
    `INSERT INTO users (id,member_id,email,password_hash,name,age,bio,interests,gender,status,role,created_at,city,languages,looking_for,terms_agreed_at,terms_version,source_kind)
     VALUES (?,?,?,?,?,?,?,?, 'woman','active','user',?,?,?,'',?,?, 'direct')`,
  )
  const now = Date.now()
  DEMO.forEach(([name, age, city, languages, interests, bio], i) => {
    const email = `${name.toLowerCase()}${DOMAIN}`
    if (existing.has(email)) return
    added++
    if (dry) return
    // A long random password: it is hashed and never shown, so nobody can sign in as a demo member.
    ins.run(newId(), newMemberId(), email, hashPassword(randomBytes(24).toString('hex')), name, age, bio, JSON.stringify(interests),
      now - i * 60_000, city, JSON.stringify(languages), now, TERMS_VERSION)
  })
  console.log(`${dry ? 'Would add' : 'Added'} ${added} demo member(s); ${existing.size} already existed.`)
}

function remove() {
  const ids = demoIds()
  if (ids.length === 0) return console.log('No demo members found.')
  const marks = ids.map(() => '?').join(',')
  const run = (sql: string, ...p: string[]) => { if (!dry) db.prepare(sql).run(...p) }
  const conns = (db.prepare(`SELECT id FROM connections WHERE a_id IN (${marks}) OR b_id IN (${marks})`).all(...ids, ...ids) as { id: string }[]).map((c) => c.id)
  db.exec('BEGIN')
  try {
    if (conns.length) {
      const cm = conns.map(() => '?').join(',')
      for (const t of ['message_reads', 'messages']) {
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(t)) run(`DELETE FROM ${t} WHERE connection_id IN (${cm})`, ...conns)
      }
    }
    // Delete rows in every table that points at a demo member, repeating until foreign keys no longer block anything.
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name)
    const refs: Array<{ table: string; column: string }> = []
    for (const table of tables) {
      if (table === 'users' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) continue
      for (const fk of db.prepare(`PRAGMA foreign_key_list(${table})`).all() as { from: string; table: string }[]) {
        if (fk.table === 'users') refs.push({ table, column: fk.from })
      }
    }
    let pending = refs
    for (let pass = 0; pass < 6 && pending.length; pass++) {
      const failed: typeof pending = []
      for (const r of pending) {
        try { run(`DELETE FROM ${r.table} WHERE ${r.column} IN (${marks})`, ...ids) } catch { failed.push(r) }
      }
      pending = failed
    }
    if (conns.length) run(`DELETE FROM connections WHERE id IN (${conns.map(() => '?').join(',')})`, ...conns)
    run(`DELETE FROM users WHERE id IN (${marks})`, ...ids)
    db.exec(dry ? 'ROLLBACK' : 'COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  console.log(`${dry ? 'Would remove' : 'Removed'} ${ids.length} demo member(s) and ${conns.length} chat(s) with them.`)
}

if (cmd === 'add') add()
else if (cmd === 'remove') remove()
else { console.error('Usage: node src/scripts/demo-members.ts add|remove [--dry-run]'); process.exit(1) }
