import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { createReadStream } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { audit, db, newId } from './db.ts'
import { authed, getUser, requireActive, requireAdmin } from './guards.ts'
import { getPlan, getPlans, paymentInstructions } from './plans.ts'
import { UPLOAD_DIR, removeQuietly, sniffImage, tx } from './verification.ts'

const MAX_PROOF = 5 * 1024 * 1024
type PaymentRow = {
  id: string; user_id: string; plan_id: string; amount_paise: number; days: number; credits: number; reference: string
  proof_file: string; proof_mime: string; status: string; reason: string | null; created_at: number; reviewed_at: number | null
}

const present = (p: PaymentRow) => ({
  id: p.id, planId: p.plan_id, amountPaise: p.amount_paise, requests: p.credits, reference: p.reference,
  status: p.status, reason: p.reason, createdAt: p.created_at, reviewedAt: p.reviewed_at,
})

export async function paymentRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_PROOF, files: 1, fields: 2, parts: 3 } })
  const member = { ...authed, preHandler: [requireActive] }

  // Request packs are for men; women use the community free.
  const notMan = (id: string) => getUser(id)?.gender !== 'man'

  app.get('/v0/membership/plans', member, async (req, reply) => {
    if (notMan(req.user.sub)) return reply.code(403).send({ error: 'not_applicable' })
    return { plans: getPlans(), payment: paymentInstructions() }
  })

  app.get('/v0/payments/mine', member, async (req) => {
    const rows = db.prepare('SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user.sub) as PaymentRow[]
    return rows.map(present)
  })

  app.post('/v0/payments', member, async (req, reply) => {
    if (notMan(req.user.sub)) return reply.code(403).send({ error: 'not_applicable' })
    if (!req.isMultipart()) return reply.code(415).send({ error: 'multipart_required' })
    const fields: Record<string, string> = {}
    let proof: Buffer | undefined
    try {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          if (part.fieldname !== 'proof' || proof) return reply.code(400).send({ error: 'invalid_input' })
          proof = await part.toBuffer() // throws if over the size limit
        } else if (part.fieldname === 'planId' || part.fieldname === 'reference') {
          fields[part.fieldname] = String(part.value)
        } else {
          return reply.code(400).send({ error: 'invalid_input' })
        }
      }
    } catch (e: any) {
      if (e?.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: 'file_too_large' })
      return reply.code(400).send({ error: 'invalid_input' })
    }

    const input = z.object({
      planId: z.string(),
      // Bank/UPI transaction reference: normalized to upper case so "abc123" and "ABC123" collide.
      reference: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,30}$/),
    }).safeParse(fields)
    if (!input.success || !proof) return reply.code(400).send({ error: 'invalid_input' })
    const plan = getPlan(input.data.planId)
    if (!plan) return reply.code(400).send({ error: 'unknown_plan' })
    const type = sniffImage(proof)
    if (!type) return reply.code(415).send({ error: 'unsupported_type', field: 'proof' })

    const sha = createHash('sha256').update(proof).digest('hex')
    const file = `${newId()}.${type.ext}`
    await writeFile(path.join(UPLOAD_DIR, file), proof, { mode: 0o600 })

    let result: 'ok' | 'payment_pending' | 'reference_used' | 'proof_reused'
    try {
      result = tx(() => {
        if (db.prepare("SELECT 1 FROM payments WHERE user_id = ? AND status = 'pending'").get(req.user.sub)) return 'payment_pending' as const
        if (db.prepare("SELECT 1 FROM payments WHERE reference = ? AND status != 'rejected'").get(input.data.reference)) return 'reference_used' as const
        if (db.prepare("SELECT 1 FROM payments WHERE proof_sha256 = ? AND status != 'rejected'").get(sha)) return 'proof_reused' as const
        // Price and request count are snapshotted from the server-side plan, never taken from the client.
        db.prepare(
          'INSERT INTO payments (id,user_id,plan_id,amount_paise,days,credits,reference,proof_file,proof_mime,proof_sha256,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        ).run(newId(), req.user.sub, plan.id, plan.amountPaise, 0, plan.requests, input.data.reference, file, type.mime, sha, Date.now())
        return 'ok' as const
      })
    } catch (e) {
      await removeQuietly(file)
      throw e
    }
    if (result !== 'ok') {
      await removeQuietly(file)
      return reply.code(409).send({ error: result })
    }
    return reply.code(201).send({ status: 'pending' })
  })

  // ---- admin --------------------------------------------------------------
  const admin = { ...authed, preHandler: [requireAdmin] }

  app.get('/v0/admin/payments', admin, async (req, reply) => {
    const q = z.object({ status: z.enum(['pending', 'approved', 'rejected']).default('pending') }).safeParse(req.query)
    if (!q.success) return reply.code(400).send({ error: 'invalid_input' })
    const rows = db.prepare(`
      SELECT p.*, u.bump_id, u.name, u.email FROM payments p JOIN users u ON u.id = p.user_id
      WHERE p.status = ? ORDER BY p.created_at ASC LIMIT 100`).all(q.data.status) as (PaymentRow & { bump_id: string; name: string; email: string })[]
    return rows.map((r) => ({ ...present(r), user: { bumpId: r.bump_id, name: r.name, email: r.email } }))
  })

  app.get('/v0/admin/payments/:id/proof', admin, async (req, reply) => {
    const id = z.string().uuid().safeParse((req.params as any).id)
    if (!id.success) return reply.code(400).send({ error: 'invalid_input' })
    const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(id.data) as PaymentRow | undefined
    if (!p) return reply.code(404).send({ error: 'not_found' })
    const full = path.resolve(UPLOAD_DIR, p.proof_file)
    if (!full.startsWith(UPLOAD_DIR + path.sep)) return reply.code(404).send({ error: 'not_found' })
    return reply
      .header('content-type', p.proof_mime)
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, no-store')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .send(createReadStream(full))
  })

  app.post('/v0/admin/payments/:id/decision', admin, async (req, reply) => {
    const id = z.string().uuid().safeParse((req.params as any).id)
    const body = z.discriminatedUnion('decision', [
      z.object({ decision: z.literal('approve') }),
      z.object({ decision: z.literal('reject'), reason: z.string().trim().min(1).max(300) }),
    ]).safeParse(req.body)
    if (!id.success || !body.success) return reply.code(400).send({ error: 'invalid_input' })

    const outcome = tx(() => {
      const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(id.data) as PaymentRow | undefined
      if (!p) return 'not_found' as const
      const approve = body.data.decision === 'approve'
      const res = db.prepare(
        "UPDATE payments SET status=?, reason=?, reviewed_by=?, reviewed_at=? WHERE id=? AND status='pending'",
      ).run(approve ? 'approved' : 'rejected', body.data.decision === 'reject' ? body.data.reason : null, req.user.sub, Date.now(), p.id)
      if (res.changes === 0) return 'already_decided' as const
      // Approval adds the pack's requests to the member's balance, in the same transaction as the decision.
      if (approve) db.prepare('UPDATE users SET request_credits = request_credits + ? WHERE id = ?').run(p.credits, p.user_id)
      audit(req.user.sub, approve ? 'payment.approve' : 'payment.reject', p.user_id, {
        paymentId: p.id, planId: p.plan_id, requests: p.credits, amountPaise: p.amount_paise,
        ...(body.data.decision === 'reject' ? { reason: body.data.reason } : {}),
      })
      return 'ok' as const
    })
    if (outcome === 'not_found') return reply.code(404).send({ error: 'not_found' })
    if (outcome === 'already_decided') return reply.code(409).send({ error: 'already_decided' })
    return { ok: true }
  })
}
