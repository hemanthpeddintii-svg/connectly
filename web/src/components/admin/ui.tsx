import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAdminSettingsQuery } from '../../features/admin/api'
import { BackIcon } from '../icons'

export const aBtn = 'inline-flex min-h-11 items-center justify-center rounded-full px-5 text-[15px] font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-50'
export const aPrimary = `${aBtn} bg-ember text-ink`
export const aDark = `${aBtn} bg-ink text-paper`
export const aOutline = `${aBtn} border border-stone-300 bg-transparent text-ink`
export const aDanger = `${aBtn} bg-ember-deep text-paper`
export const aField = 'w-full rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-[15px] text-ink placeholder:text-stone-500 focus:border-ink'
export const aCard = 'rounded-2xl bg-white p-5'
export const th = 'px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.06em] text-slate'
export const td = 'px-3 py-3 text-sm align-middle'

export function PageTitle({ title, sub, back, backLabel }: { title: string; sub?: string; back?: string; backLabel?: string }) {
  return (
    <header className="mb-5 flex flex-col gap-1">
      {back && (
        <Link to={back} className="mb-1 inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-slate hover:text-ink">
          <BackIcon size={18} /> {backLabel}
        </Link>
      )}
      <h1 className="font-display text-[26px] font-semibold leading-tight">{title}</h1>
      {sub && <p className="text-[15px] text-slate">{sub}</p>}
    </header>
  )
}

const tones: Record<string, string> = {
  pending: 'bg-ember/15 text-ember-deep', open: 'bg-ember/15 text-ember-deep',
  approved: 'bg-verified/15 text-verified', active: 'bg-verified/15 text-verified', actioned: 'bg-verified/15 text-verified',
  rejected: 'bg-mist text-slate', dismissed: 'bg-mist text-slate',
  suspended: 'bg-ember-deep text-paper', deleted: 'bg-mist text-slate',
}
export function StatusPill({ status }: { status: string }) {
  return <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold capitalize ${tones[status] ?? 'bg-mist text-slate'}`}>{status}</span>
}

export function Tabs<T extends string>({ value, options, onChange, label }: { value: T; options: readonly T[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="mb-4 flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(o)}
          className={`min-h-11 rounded-full px-4 text-sm font-semibold capitalize ${value === o ? 'bg-ink text-paper' : 'border border-stone-300'}`}>{o}</button>
      ))}
    </div>
  )
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' }) {
  return <p role={tone === 'error' ? 'alert' : 'status'} className={`text-sm ${tone === 'error' ? 'text-ember-deep' : 'text-slate'}`}>{children}</p>
}

/** Reject form: reason field plus the quick-reason chips configured in Settings. */
export function RejectForm({ kind, busy, label = 'Confirm reject', onSubmit, onCancel }: {
  kind: 'verification' | 'payment'; busy: boolean; label?: string; onSubmit: (reason: string) => void; onCancel: () => void
}) {
  const { data } = useAdminSettingsQuery()
  const [reason, setReason] = useState('')
  const chips = data?.quickReasons[kind] ?? []
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); onSubmit(reason.trim()) }}>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Reason shown to the member
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required rows={2} autoFocus className={`${aField} font-normal`} />
      </label>
      {chips.length > 0 && (
        <div role="group" aria-label="Quick reasons" className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <button key={c} type="button" onClick={() => setReason(c)} className="min-h-9 rounded-full bg-mist px-3 text-[13px] font-medium hover:bg-fog">{c}</button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button disabled={busy || !reason.trim()} className={aDanger}>{label}</button>
        <button type="button" onClick={onCancel} className={aOutline}>Cancel</button>
      </div>
    </form>
  )
}

export function DL({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([k, v]) => (<div key={k} className="contents"><dt className="text-slate">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>))}
    </dl>
  )
}
