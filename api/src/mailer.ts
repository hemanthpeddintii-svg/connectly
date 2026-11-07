/**
 * Outbound email. With SMTP_HOST set, mail goes through SMTP (nodemailer; Gmail works with an App Password,
 * see docs/EMAIL.md). Otherwise, outside production, the message is printed to the server log; in production
 * it is dropped with a warning. Contents (which can include one-time links) are never logged in production
 * and credentials are never logged at all.
 */
import nodemailer from 'nodemailer'

export type Mail = { to: string; subject: string; text: string }
type Transport = (mail: Mail) => Promise<void>

const consoleTransport: Transport = async (m) => {
  if (process.env.NODE_ENV === 'production') {
    console.warn(`[mail] no mail transport configured; dropped "${m.subject}"`)
    return
  }
  console.log(`[mail] to=${m.to} subject=${m.subject}\n${m.text}`)
}

export type SmtpOptions = {
  host: string; port: number; secure: boolean
  auth?: { user: string; pass: string }
  from: string
}

/** Reads SMTP settings from the environment; null when SMTP_HOST is unset. */
export function smtpOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpOptions | null {
  const host = env.SMTP_HOST?.trim()
  if (!host) return null
  const port = Number(env.SMTP_PORT) || 587
  const user = env.SMTP_USER?.trim()
  const pass = env.SMTP_PASS
  return {
    host, port,
    secure: env.SMTP_SECURE === 'true' || port === 465,
    ...(user && pass ? { auth: { user, pass } } : {}),
    from: env.MAIL_FROM?.trim() || user || 'no-reply@localhost',
  }
}

/** Builds a nodemailer-backed transport (no connection is made until the first send). */
export function buildSmtpTransport(o: SmtpOptions): Transport {
  const t = nodemailer.createTransport({ host: o.host, port: o.port, secure: o.secure, auth: o.auth })
  return async (m) => { await t.sendMail({ from: o.from, to: m.to, subject: m.subject, text: m.text }) }
}

const smtp = smtpOptionsFromEnv()
let transport: Transport = smtp ? buildSmtpTransport(smtp) : consoleTransport
let configured = smtp !== null

export const setMailer = (t: Transport) => { transport = t; configured = true }
/** True when a real transport (SMTP or an injected one) is in place. */
export const mailConfigured = () => configured

/** Never throws: a mail failure must not change an API response (that would leak whether an account exists). */
export async function sendMail(m: Mail) {
  try { await transport(m) } catch { console.error('[mail] delivery failed') }
}
