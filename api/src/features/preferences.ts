import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db.ts'
import { authed, requireActive } from '../guards.ts'
import { wallFilters, type SqlFragment } from './hooks.ts'

db.exec(`
  CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    min_age INTEGER,
    max_age INTEGER,
    interests TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER NOT NULL
  );
`)

const age = z.number().int().min(18).max(120).nullable().optional()
const bodySchema = z
  .object({
    minAge: age,
    maxAge: age,
    interests: z.array(z.string().trim().min(1).max(30)).max(12).optional(),
  })
  .strict()
  .refine((d) => d.minAge == null || d.maxAge == null || d.minAge <= d.maxAge, { path: ['minAge'] })

type PrefRow = { min_age: number | null; max_age: number | null; interests: string }

const readPrefs = (userId: string) =>
  db.prepare('SELECT min_age, max_age, interests FROM user_preferences WHERE user_id = ?').get(userId) as PrefRow | undefined

const toJson = (p: PrefRow | undefined) => ({
  minAge: p?.min_age ?? null,
  maxAge: p?.max_age ?? null,
  interests: p ? (JSON.parse(p.interests) as string[]) : [],
})

const dedupeCaseInsensitive = (items: string[]) => {
  const seen = new Set<string>()
  return items.filter((i) => {
    const key = i.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// SQLite's lower() only folds ASCII, so fold the viewer's terms the same way to keep both sides comparable.
const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase())

wallFilters.push((viewerId): SqlFragment | null => {
  const p = readPrefs(viewerId)
  if (!p) return null
  const parts: string[] = []
  const params: SqlFragment['params'] = []
  if (p.min_age !== null) { parts.push('u.age >= ?'); params.push(p.min_age) }
  if (p.max_age !== null) { parts.push('u.age <= ?'); params.push(p.max_age) }
  const interests = JSON.parse(p.interests) as string[]
  if (interests.length > 0) {
    parts.push(
      `EXISTS (SELECT 1 FROM json_each(u.interests) j WHERE j.type = 'text' AND lower(j.value) IN (${interests.map(() => '?').join(',')}))`,
    )
    params.push(...interests.map(asciiLower))
  }
  return parts.length ? { sql: parts.join(' AND '), params } : null
})

export async function preferencesRoutes(app: FastifyInstance) {
  const member = { ...authed, preHandler: [requireActive] }

  app.get('/v0/preferences', member, async (req) => toJson(readPrefs(req.user.sub)))

  app.put('/v0/preferences', member, async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const { minAge = null, maxAge = null, interests = [] } = parsed.data
    db.prepare(`
      INSERT INTO user_preferences (user_id, min_age, max_age, interests, updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET min_age=excluded.min_age, max_age=excluded.max_age,
        interests=excluded.interests, updated_at=excluded.updated_at`)
      .run(req.user.sub, minAge, maxAge, JSON.stringify(dedupeCaseInsensitive(interests)), Date.now())
    return toJson(readPrefs(req.user.sub))
  })

  app.delete('/v0/preferences', member, async (req) => {
    db.prepare('DELETE FROM user_preferences WHERE user_id = ?').run(req.user.sub)
    return toJson(undefined)
  })
}
