import type { ReactNode } from 'react'
import { btnSecondary } from '../ui'
import { ArchIcon } from './icons'

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <p role="status" className="py-6 text-center text-slate">{label}</p>
}

export function ErrorState({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-8 text-center">
      <p className="text-slate">We couldn't load {what}. Check your connection and try again.</p>
      <button type="button" onClick={onRetry} className={`${btnSecondary} h-11`}>Try again</button>
    </div>
  )
}

/** A friendly empty state: a small arch, a title, a line or two, and optional actions. */
export function EmptyState({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-2 py-12 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-mist text-ink"><ArchIcon size={32} /></span>
      <h2 className="font-display text-2xl font-semibold">{title}</h2>
      <div className="flex max-w-sm flex-col gap-2 text-[15px] leading-relaxed text-slate">{children}</div>
      {actions && <div className="mt-2 flex w-full max-w-xs flex-col gap-3">{actions}</div>}
    </div>
  )
}
