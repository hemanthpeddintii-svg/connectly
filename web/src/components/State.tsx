import type { ReactNode } from 'react'
import { btnSecondary } from '../ui'
import { ArchIcon } from './icons'

/** Three quiet dots instead of a spinner: calm, and still when motion is reduced. */
export function Loading({ label = 'One moment…' }: { label?: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 py-12 text-slate">
      <span aria-hidden="true" className="flex gap-1.5">
        {[0, 1, 2].map((i) => <span key={i} className="lp-bob h-1.5 w-1.5 rounded-full bg-stone-300" style={{ animationDelay: `${i * -0.5}s`, animationDuration: '1.6s' }} />)}
      </span>
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function ErrorState({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
      <p className="text-slate">Couldn't load {what}. Check your connection and give it another go.</p>
      <button type="button" onClick={onRetry} className={`${btnSecondary} !h-11`}>Try again</button>
    </div>
  )
}

/** A friendly empty state: a small arch, a title, a line or two, and optional actions. */
export function EmptyState({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 px-2 py-16 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-mist text-ink"><ArchIcon size={30} /></span>
      <h2 className="font-display text-[28px] leading-tight">{title}</h2>
      <div className="flex max-w-sm flex-col gap-2 text-[15px] leading-relaxed text-slate">{children}</div>
      {actions && <div className="mt-2 flex w-full max-w-xs flex-col gap-3">{actions}</div>}
    </div>
  )
}
