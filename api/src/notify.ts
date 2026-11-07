/**
 * Request notifications. A sent request tells the woman, an accepted one tells the man; declines never notify.
 * Messages are privacy-preserving: no names, no note text. Failures never touch the HTTP response.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from './db.ts'
import { authed } from './guards.ts'
import { sendMail } from './mailer.ts'
import { sendPushToUser } from './features/push.ts'
import { requestListeners, sockets, type RequestEvent } from './features/hooks.ts'

db.exec(`
  CREATE TABLE IF NOT EXISTS notification_prefs (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    email_requests INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS notification_email_log (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    last_sent_at INTEGER NOT NULL
  );
`)

export const EMAIL_MIN_GAP_MS = 15 * 60 * 1000

const appUrl = () => (process.env.WEB_ORIGIN ?? 'http://localhost:5173').replace(/\/$/, '')

export const emailEnabled = (userId: string) =>
  ((db.prepare('SELECT email_requests AS v FROM notification_prefs WHERE user_id = ?').get(userId) as { v: number } | undefined)?.v ?? 1) === 1

/** Atomically claims the right to email this member now (single statement; the DB serialises concurrent callers). */
function claimEmailSlot(userId: string, now = Date.now()): boolean {
  const r = db.prepare(`
    INSERT INTO notification_email_log (user_id, last_sent_at) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET last_sent_at = excluded.last_sent_at WHERE last_sent_at <= ?
  `).run(userId, now, now - EMAIL_MIN_GAP_MS)
  return Number(r.changes) === 1
}

const COPY = {
  sent: {
    path: '/requests', title: 'You have a new request', push: 'Someone would like to connect. Open Connectly to take a look.',
    subject: 'You have a new request on Connectly',
    lead: 'A verified member would like to connect with you. There is no rush, and you are always free to say not now.',
    cta: 'View your requests',
  },
  accepted: {
    path: '/sent', title: 'Good news', push: 'A request you sent was accepted. You can chat now.',
    subject: 'Good news from Connectly',
    lead: 'A request you sent was accepted. You can start chatting whenever you are ready.',
    cta: 'Open your sent requests',
  },
} as const

export function buildEmail(kind: RequestEvent['kind']) {
  const c = COPY[kind]
  return { subject: c.subject, text: `Hello,\n\n${c.lead}\n\n${c.cta}: ${appUrl()}${c.path}\n\nWarmly,\nThe Connectly team\n\nYou can turn these emails off in Settings, Notifications.\n` }
}

/** Handles one request event. Never throws. */
export async function handleRequestEvent(e: RequestEvent): Promise<void> {
  try {
    const c = COPY[e.kind]
    const live = (sockets.get(e.recipientId)?.size ?? 0) > 0
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(e.recipientId) as { email: string } | undefined
    if (!user) return
    if (!live && emailEnabled(e.recipientId) && claimEmailSlot(e.recipientId)) {
      await sendMail({ to: user.email, ...buildEmail(e.kind) })
    }
    if (!live) await sendPushToUser(e.recipientId, c.title, c.push, c.path)
  } catch { console.error('[notify] failed') }
}

export async function notifyRoutes(app: FastifyInstance) {
  requestListeners.push((e) => { void handleRequestEvent(e) })

  app.get('/v0/notifications', authed, async (req) => ({ emailRequests: emailEnabled(req.user.sub) }))

  app.put('/v0/notifications', authed, async (req, reply) => {
    const body = z.object({ emailRequests: z.boolean() }).strict().safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' })
    db.prepare(`INSERT INTO notification_prefs (user_id, email_requests) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET email_requests = excluded.email_requests`).run(req.user.sub, body.data.emailRequests ? 1 : 0)
    return { emailRequests: body.data.emailRequests }
  })
}
