/**
 * Outbound email. No SMTP/provider is bundled because that needs your credentials: call `setMailer`
 * at startup with your own transport. Until then, outside production the message is printed to the
 * server log (handy for development); in production it is dropped with a warning and its contents
 * (which include one-time links) are never logged.
 */
export type Mail = { to: string; subject: string; text: string }
type Transport = (mail: Mail) => Promise<void>

const consoleTransport: Transport = async (m) => {
  if (process.env.NODE_ENV === 'production') {
    console.warn(`[mail] no mail transport configured; dropped "${m.subject}"`)
    return
  }
  console.log(`[mail] to=${m.to} subject=${m.subject}\n${m.text}`)
}

let transport: Transport = consoleTransport
export const setMailer = (t: Transport) => { transport = t }

/** Never throws: a mail failure must not change an API response (that would leak whether an account exists). */
export async function sendMail(m: Mail) {
  try { await transport(m) } catch { console.error('[mail] delivery failed') }
}
