export const inr = (paise: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: paise % 100 ? 2 : 0 }).format(paise / 100)

// Day first with a spelled-out month ('10 Nov 2026, 1:21 am'), so 11/10 can never be read as 10 November or 11 October.
export const dateTime = (ms: number) =>
  new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
export const dateOnly = (ms: number) => new Date(ms).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "Sent today", "3 days ago", "last week": a calm, approximate age for a request. */
export function sentAgo(ms: number, now = Date.now()) {
  const days = Math.floor((now - ms) / 86_400_000)
  if (days < 1) return 'Sent today'
  if (days === 1) return 'Sent yesterday'
  if (days < 7) return `Sent ${days} days ago`
  if (days < 14) return 'Sent last week'
  return `Sent ${dateOnly(ms)}`
}
