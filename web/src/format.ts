export const inr = (paise: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: paise % 100 ? 2 : 0 }).format(paise / 100)

export const dateTime = (ms: number) => new Date(ms).toLocaleString()
export const dateOnly = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

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
