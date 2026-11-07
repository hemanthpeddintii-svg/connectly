import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { reasonLabel, useAdminReportsQuery, useDecideReportMutation, useLiftSuspensionMutation, type ReportStatus } from '../../features/safety/api'
import { ago } from '../../features/admin/api'
import { dateTime } from '../../format'
import { EmptyState, ErrorState, Loading } from '../../components/State'
import { PageTitle, Tabs, StatusPill, DL, Notice, aCard, aOutline, aDark, aDanger, aField, th, td } from '../../components/admin/ui'

const TABS = ['open', 'actioned', 'dismissed'] as const

export function ReportQueue() {
  const [tab, setTab] = useState<ReportStatus>('open')
  const { data, isLoading, isError, refetch } = useAdminReportsQuery(tab)
  return (
    <>
      <PageTitle title="Reports" sub="Member reports, newest first." />
      <Tabs label="Report status" value={tab} options={TABS} onChange={setTab} />
      {isLoading ? <Loading /> : isError ? <ErrorState what="reports" onRetry={refetch} />
        : !data?.length ? <EmptyState title={`No ${tab} reports`}><p>Nothing to review here.</p></EmptyState>
        : (
          <div className="overflow-x-auto rounded-2xl bg-white">
            <table className="w-full min-w-[520px]">
              <caption className="sr-only">Reports, {tab}</caption>
              <thead><tr className="border-b border-stone-200"><th scope="col" className={th}>Reason</th><th scope="col" className={th}>Reported member</th><th scope="col" className={th}>Reported</th><th scope="col" className={th}>Status</th><th scope="col" className={th}><span className="sr-only">Open</span></th></tr></thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.report.id} className="border-b border-stone-200 last:border-b-0">
                    <th scope="row" className={`${td} text-left font-semibold`}>{reasonLabel(r.report.reason)}</th>
                    <td className={td}>{r.reported.name}<span className="block text-xs text-slate">{r.reported.bumpId}</span></td>
                    <td className={td}>{ago(r.report.createdAt)}</td>
                    <td className={td}><StatusPill status={r.report.status} /></td>
                    <td className={`${td} text-right`}><Link to={r.report.id} aria-label={`Review report on ${r.reported.name}`} className="font-semibold underline">Review</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </>
  )
}

export function ReportCase() {
  const { id = '' } = useParams()
  const open = useAdminReportsQuery('open')
  const actioned = useAdminReportsQuery('actioned', { skip: !open.isSuccess })
  const dismissed = useAdminReportsQuery('dismissed', { skip: !open.isSuccess })
  const item = [...(open.data ?? []), ...(actioned.data ?? []), ...(dismissed.data ?? [])].find((x) => x.report.id === id)
  const done = open.isSuccess && actioned.isSuccess && dismissed.isSuccess
  const [decide, { isLoading: busy }] = useDecideReportMutation()
  const [lift, { isLoading: lifting }] = useLiftSuspensionMutation()
  const [acting, setActing] = useState(false)
  const [note, setNote] = useState('')
  const [suspend, setSuspend] = useState(false)
  const [error, setError] = useState('')

  async function run(arg: Parameters<typeof decide>[0]) {
    setError('')
    try { await decide(arg).unwrap(); setActing(false) }
    catch (e: any) { setError(e?.data?.error === 'already_decided' ? 'Someone else already decided this report.' : 'Could not save the decision.') }
  }

  const head = <PageTitle title="Report case" back="/admin/reports" backLabel="All reports" />
  if (open.isError) return <>{head}<ErrorState what="this report" onRetry={open.refetch} /></>
  if (!item) return <>{head}{done ? <EmptyState title="Report not found"><p>It may have been removed.</p></EmptyState> : <Loading />}</>
  const { report, reporter, reported } = item
  return (
    <>
      {head}
      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-label="Report" className={`${aCard} flex flex-col gap-4`}>
          <div className="flex items-center gap-3"><h2 className="font-display text-lg font-semibold">{reasonLabel(report.reason)}</h2><StatusPill status={report.status} /></div>
          <p className="whitespace-pre-wrap text-[15px]">{report.details || <span className="text-slate">No details given.</span>}</p>
          <DL rows={[
            ['Reported', dateTime(report.createdAt)],
            ['Reporter', `${reporter.name} (${reporter.bumpId})`],
            ['Reported member', <Link key="m" className="underline" to={`/admin/members/${reported.bumpId}`}>{reported.name}, {reported.age}</Link>],
            ['Email', reported.email], ['Open reports', String(reported.openReportCount)],
            ['Account', reported.suspended ? 'Suspended' : 'Active'],
          ]} />
        </section>
        <section aria-label="Decision" className={`${aCard} flex flex-col gap-4`}>
          {report.status !== 'open' && (
            <p className="text-sm text-slate">{report.status === 'actioned' ? 'Action taken' : 'Dismissed'}{report.note ? `: ${report.note}` : ''}{report.reviewedAt ? ` · ${dateTime(report.reviewedAt)}` : ''}</p>
          )}
          {report.status === 'open' && (acting ? (
            <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run({ id: report.id, decision: 'action', note: note.trim(), suspend }) }}>
              <label className="flex flex-col gap-1.5 text-sm font-semibold">Note
                <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} required rows={3} autoFocus className={`${aField} font-normal`} />
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={suspend} onChange={(e) => setSuspend(e.target.checked)} /> Suspend this member</label>
              <div className="flex flex-wrap gap-2">
                <button disabled={busy || !note.trim()} className={aDanger}>Confirm action</button>
                <button type="button" onClick={() => setActing(false)} className={aOutline}>Cancel</button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button disabled={busy} onClick={() => run({ id: report.id, decision: 'dismiss' })} className={aOutline}>Dismiss</button>
              <button disabled={busy} onClick={() => setActing(true)} className={aDark}>Take action…</button>
            </div>
          ))}
          {reported.suspended && (
            <div><button disabled={lifting} className={aOutline} onClick={async () => {
              setError('')
              try { await lift(reported.bumpId).unwrap() } catch { setError('Could not lift the suspension.') }
            }}>Lift suspension</button></div>
          )}
          {error && <Notice tone="error">{error}</Notice>}
        </section>
      </div>
    </>
  )
}
