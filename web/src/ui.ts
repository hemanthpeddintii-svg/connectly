/** Shared class strings so buttons, fields and cards look the same on every screen. Calm and minimal: ink buttons, hairline borders, soft corners. */
const pill = 'inline-flex select-none items-center justify-center rounded-full font-medium transition duration-200 ease-[var(--ease-calm)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100'

/** The main action on a screen. */
export const btnPrimary = `${pill} h-[52px] bg-ink px-7 text-base text-paper hover:bg-ink/90`
/** Reserved for the two emotional moments: sending a request and accepting one. */
export const btnAccent = `${pill} h-[52px] bg-ember px-7 text-base font-semibold text-ink hover:brightness-95`
export const btnSecondary = `${pill} h-[52px] bg-mist px-6 text-base text-ink hover:bg-stone-200`
export const btnOutline = `${pill} h-[52px] border border-stone-300 bg-transparent px-6 text-base text-ink hover:border-ink`
export const btnSmall = `${pill} h-11 px-5 text-[15px]`
export const field = 'w-full rounded-xl border border-stone-300 bg-white px-4 py-3.5 text-[15px] text-ink transition placeholder:text-stone-500 hover:border-stone-500 focus:border-ink focus:outline-none focus:ring-4 focus:ring-ink/5'
export const card = 'rounded-[22px] border border-stone-200 bg-white p-6'
export const eyebrow = 'text-xs font-medium uppercase tracking-[0.14em] text-slate'
export const chip = 'inline-flex h-[30px] items-center rounded-full bg-mist px-3 text-[13px] font-medium'
