import { useEffect, useId, useRef, useState } from 'react'
import { REASONS, useBlockMemberMutation, useReportMemberMutation, type ReportReason } from './api'

const MAX_DETAILS = 500

const reportError = (e: any) =>
  e?.data?.error === 'already_reported' ? 'You already have an open report about this member.'
    : e?.data?.error === 'rate_limited' ? "You've sent too many reports today. Please try again tomorrow."
      : e?.data?.error === 'not_found' ? 'This member is no longer available.'
        : 'Could not send the report. Please try again.'

function ReportPanel({ bumpId, onClose }: { bumpId: string; onClose: () => void }) {
  const [report, { isLoading }] = useReportMemberMutation()
  const [reason, setReason] = useState<ReportReason>('harassment')
  const [details, setDetails] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const id = useId()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await report({ bumpId, reason, details: details.trim() || undefined }).unwrap()
      setSent(true)
    } catch (err) { setError(reportError(err)) }
  }

  return (
    <div role="dialog" aria-label="Report this member" className="mt-2 flex w-72 max-w-full flex-col gap-3 rounded-lg border border-stone-200 bg-white p-4 shadow-lg">
      {sent ? (
        <>
          <p role="status" className="text-sm text-emerald-800">Thanks. Your report was sent to our team. The member is not told who reported them.</p>
          <button onClick={onClose} className="self-end rounded-md border border-stone-300 px-3 py-1.5 text-sm">Close</button>
        </>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-reason`} className="text-sm font-medium">Reason</label>
            <select id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value as ReportReason)}
              className="rounded-md border border-stone-300 px-2 py-2 text-sm">
              {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-details`} className="text-sm font-medium">Details <span className="font-normal text-stone-500">(optional)</span></label>
            <textarea id={`${id}-details`} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={MAX_DETAILS} rows={3}
              className="rounded-md border border-stone-300 px-2 py-2 text-sm" />
            <span className="self-end text-xs text-stone-500" aria-live="polite">{details.length}/{MAX_DETAILS}</span>
          </div>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-stone-300 px-3 py-1.5 text-sm">Cancel</button>
            <button disabled={isLoading} className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
              {isLoading ? 'Sending…' : 'Send report'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

export default function SafetyMenu({ bumpId }: { bumpId: string }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'menu' | 'block' | 'report'>('menu')
  const [block, { isLoading: blocking, isError: blockFailed }] = useBlockMemberMutation()
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = () => { setMode('menu'); setOpen((o) => !o) }
  const item = 'block w-full px-4 py-2 text-left text-sm hover:bg-stone-100 focus:bg-stone-100 focus:outline-none'

  return (
    <div ref={root} className="relative inline-block">
      <button ref={button} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        aria-label="More options" onClick={toggle}
        className="rounded-md px-2 py-1 text-lg leading-none text-stone-600 hover:bg-stone-100">
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div id={menuId} className="absolute right-0 z-20">
          {mode === 'menu' && (
            <div role="menu" className="mt-1 w-40 overflow-hidden rounded-lg border border-stone-200 bg-white py-1 shadow-lg">
              <button role="menuitem" className={item} onClick={() => setMode('block')}>Block</button>
              <button role="menuitem" className={item} onClick={() => setMode('report')}>Report</button>
            </div>
          )}
          {mode === 'block' && (
            <div role="alertdialog" aria-label="Block this member" className="mt-1 flex w-64 flex-col gap-3 rounded-lg border border-stone-200 bg-white p-4 shadow-lg">
              <p className="text-sm">Block this member? You won't see each other any more. You can unblock them in Settings.</p>
              {blockFailed && <p role="alert" className="text-sm text-red-600">Could not block. Please try again.</p>}
              <div className="flex justify-end gap-2">
                <button onClick={() => setOpen(false)} className="rounded-md border border-stone-300 px-3 py-1.5 text-sm">Cancel</button>
                <button disabled={blocking} onClick={() => block(bumpId).unwrap().then(() => setOpen(false), () => {})}
                  className="rounded-md bg-red-700 px-3 py-1.5 text-sm text-white disabled:opacity-50">{blocking ? 'Blocking…' : 'Block'}</button>
              </div>
            </div>
          )}
          {mode === 'report' && <ReportPanel bumpId={bumpId} onClose={() => setOpen(false)} />}
        </div>
      )}
    </div>
  )
}
