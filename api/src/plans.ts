/**
 * Membership plans. Prices are PLACEHOLDERS: the original product's pricing is behind login
 * and was not observed. Set your own. Amounts are in paise (INR minor units).
 */
export type Plan = { id: string; name: string; amountPaise: number; days: number }

export const PLANS: readonly Plan[] = [
  { id: 'monthly', name: '1 month', amountPaise: 49900, days: 30 },
  { id: 'quarterly', name: '3 months', amountPaise: 119900, days: 90 },
]

export const getPlan = (id: string) => PLANS.find((p) => p.id === id)

/** Payee details shown to members. Null until configured; the UI says so rather than inventing one. */
export const paymentInstructions = () => ({
  payeeName: process.env.PAYMENT_PAYEE_NAME ?? null,
  upiId: process.env.PAYMENT_UPI_ID ?? null,
  currency: 'INR',
})
