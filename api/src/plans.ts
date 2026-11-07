/**
 * Request packs: men buy requests (one request = one introduction to a woman). Amounts are in paise (INR minor units).
 * Prices are set by the product owner: 10 requests for 499 rupees and 20 for 899 rupees.
 */
export type Plan = { id: string; name: string; amountPaise: number; requests: number }

export const PLANS: readonly Plan[] = [
  { id: 'pack10', name: '10 requests', amountPaise: 49900, requests: 10 },
  { id: 'pack20', name: '20 requests', amountPaise: 89900, requests: 20 },
]

export const getPlan = (id: string) => PLANS.find((p) => p.id === id)

/** Payee details shown to members. Null until configured; the UI says so rather than inventing one. */
export const paymentInstructions = () => ({
  payeeName: process.env.PAYMENT_PAYEE_NAME ?? null,
  upiId: process.env.PAYMENT_UPI_ID ?? null,
  currency: 'INR',
})
