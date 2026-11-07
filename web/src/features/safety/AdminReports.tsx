import { useState } from 'react'
import {
  reasonLabel, useAdminReportsQuery, useDecideReportMutation, useLiftSuspensionMutation,
  type AdminReport, type ReportStatus,
} from './api'

const errorText = (e: any) =>
  e?.data?.error === 'already_decided' ? 'Someone else already decided this report.' : 'Could not save the decision.'

function Card({ item, status }: { item: AdminReport; status: ReportStatus }) {
  const { report, reporter, reported } = item
  const [decide, { isLoading }] = useDecideReportMutation()
  const [lift, { isLoading: lifting }] = useLiftSuspensionMutation()
  const [acting, setActing] = useState(false)
  const [note, setNote] = useState('')
  const [suspend, setSuspend] = useState(false)
  const [error, setError] = useState('')

  async function run(p: Parameters<typeof decide>[0]) {
    setError('')
    try { await decide(p).unwrap() } catch (e) { setError(errorText(e)) }
  }
  async function liftIt() {
    setError('')
    try { await lift(reported.bumpId).unwrap() } catch { setError('Could not lift the suspension.') }
  }

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4">
      <header>
        <h3 className="font-semibold">{reasonLabel(report.reason)}</h3>
        <p className="text-sm text-stone-500">{new Date(report.createdAt).toLocaleString()}</p>
      </header>
      {report.details && <p className="whitespace-pre-wrap text-sm text-stone-700">{report.details}</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-stone-500">Reported member</dt>
        <dd>{reported.name}, {reported.age} · {reported.email} · ID {reported.bumpId}</dd>
        <dt className="text-stone-500">Open reports</dt>
        <dd>{reported.openReportCount}</dd>
        <dt className="text-stone-500">Reported by</dt>
        <dd>{reporter.name} · ID {reporter.bumpId}</dd>
        <dt className="text-stone-500">Account</dt>
        <dd>{reported.suspended ? <strong className="text-red-700">Suspended</strong> : 'Active'}</dd>
      </dl>
      {status !== 'open' && (
        <p className="text-sm text-stone-600">
          {status === 'actioned' ? 'Action taken' : 'Dismissed'}
          {report.note ? `: ${report.note}` : ''}
          {report.reviewedAt ? ` · ${new Date(report.reviewedAt).toLocaleString()}` : ''}
        </p>
      )}
      {status === 'open' && (acting ? (
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); run({ id: report.id, decision: 'action', note: note.trim(), suspend }) }}>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Note</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} required rows={2} autoFocus
              className="rounded-md border border-stone-300 px-3 py-2" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={suspend} onChange={(e) => setSuspend(e.target.checked)} />
            Suspend this member
          </label>
          <div className="flex gap-2">
            <button disabled={isLoading || !note.trim()} className="rounded-md bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-50">Confirm action</button>
            <button type="button" onClick={() => setActing(false)} className="rounded-md border border-stone-300 px-3 py-2 text-sm">Cancel</button>
          </div>
        </form>
      ) : (
        <div className="flex gap-2">
          <button disabled={isLoading} onClick={() => run({ id: report.id, decision: 'dismiss' })}
            className="rounded-md border border-stone-300 px-3 py-2 text-sm disabled:opacity-50">Dismiss</button>
          <button disabled={isLoading} onClick={() => setActing(true)}
            className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50">Take action…</button>
        </div>
      ))}
      {reported.suspended && (
        <div>
          <button disabled={lifting} onClick={liftIt} className="rounded-md border border-stone-300 px-3 py-2 text-sm disabled:opacity-50">Lift suspension</button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </article>
  )
}

export default function AdminReports() {
  const [tab, setTab] = useState<ReportStatus>('open')
  const { data, isLoading, isError, refetch } = useAdminReportsQuery(tab)
  const tabCls = (t: ReportStatus) =>
    `rounded-md px-3 py-1.5 text-sm ${tab === t ? 'bg-stone-900 text-white' : 'border border-stone-300'}`
  return (
    <section aria-label="Member reports" className="flex flex-col gap-4">
      <div role="group" aria-label="Report status" className="flex gap-2">
        {(['open', 'actioned', 'dismissed'] as const).map((t) => (
          <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)} className={tabCls(t)}>{t[0]!.toUpperCase() + t.slice(1)}</button>
        ))}
      </div>
      {isLoading && <p className="text-stone-500">Loading…</p>}
      {isError && <p>Couldn't load reports. <button className="underline" onClick={refetch}>Retry</button></p>}
      {data?.length === 0 && <p className="text-stone-500">No {tab} reports.</p>}
      {data?.map((r) => <Card key={r.report.id} item={r} status={tab} />)}
    </section>
  )
}
