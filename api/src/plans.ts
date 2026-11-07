import { db } from './db.ts'

/**
 * Request packs: men buy requests (one request = one introduction to a woman). Amounts are in paise (INR minor units).
 * Defaults: 10 requests for 499 rupees and 20 for 899 rupees; admins can change them (stored in the settings table).
 * A change applies to new purchases only: each payment row snapshots its price and request count.
 */
export type Plan = { id: string; name: string; amountPaise: number; requests: number }
export type PackSetting = { id: 'pack10' | 'pack20'; requests: number; amountPaise: number }
export type Settings = {
  packs: PackSetting[]
  payee: { name: string | null; upiId: string | null }
  quickReasons: { verification: string[]; payment: string[] }
}

export const DEFAULT_PACKS: PackSetting[] = [
  { id: 'pack10', requests: 10, amountPaise: 49900 },
  { id: 'pack20', requests: 20, amountPaise: 89900 },
]

const read = <T>(key: string): T | undefined => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  if (!row) return undefined
  try { return JSON.parse(row.value) as T } catch { return undefined }
}

export function writeSetting(key: string, value: unknown) {
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, JSON.stringify(value))
}

export function getSettings(): Settings {
  const packs = read<PackSetting[]>('packs') ?? DEFAULT_PACKS
  const payee = read<{ name: string | null; upiId: string | null }>('payee')
  return {
    packs,
    payee: {
      name: payee ? payee.name : process.env.PAYMENT_PAYEE_NAME ?? null,
      upiId: payee ? payee.upiId : process.env.PAYMENT_UPI_ID ?? null,
    },
    quickReasons: read<Settings['quickReasons']>('quickReasons') ?? { verification: [], payment: [] },
  }
}

export const getPlans = (): Plan[] =>
  getSettings().packs.map((p) => ({ id: p.id, name: `${p.requests} requests`, amountPaise: p.amountPaise, requests: p.requests }))

export const getPlan = (id: string) => getPlans().find((p) => p.id === id)

/** Payee details shown to members. Null until configured; the UI says so rather than inventing one. */
export const paymentInstructions = () => {
  const { payee } = getSettings()
  return { payeeName: payee.name, upiId: payee.upiId, currency: 'INR' }
}
