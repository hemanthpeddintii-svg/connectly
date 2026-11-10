import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAdminVerificationsQuery, useDecideVerificationMutation, type VerificationStatus } from '../../api'
import { ago } from '../../features/admin/api'
import { dateTime } from '../../format'
import { useBlobUrl } from '../../useBlobUrl'
import { EmptyState, ErrorState, Loading } from '../../components/State'
import Monogram from '../../components/Monogram'
import { PageTitle, Tabs, StatusPill, RejectForm, DL, Notice, aCard, aPrimary, aOutline, th, td } from '../../components/admin/ui'

const TABS = ['pending', 'approved', 'rejected'] as const

export function VerificationQueue() {
  const [tab, setTab] = useState<VerificationStatus>('pending')
  const { data, isLoading, isError, refetch } = useAdminVerificationsQuery(tab)
  return (
    <>
      <PageTitle title="Verifications" sub="Check each selfie and voice clip, then approve or reject." />
      <Tabs label="Verification status" value={tab} options={TABS} onChange={setTab} />
      {isLoading ? <Loading /> : isError ? <ErrorState what="verifications" onRetry={refetch} />
        : !data?.length ? <EmptyState title={`Nothing ${tab}`}><p>New submissions show up here.</p></EmptyState>
        : (
          <div className="overflow-x-auto rounded-2xl bg-white">
            <table className="w-full min-w-[480px]">
              <caption className="sr-only">Verifications, {tab}</caption>
              <thead><tr className="border-b border-stone-200"><th scope="col" className={th}>Member</th><th scope="col" className={th}>Submitted</th><th scope="col" className={th}>Status</th><th scope="col" className={th}><span className="sr-only">Open</span></th></tr></thead>
              <tbody>
                {data.map((v) => (
                  <tr key={v.id} className="border-b border-stone-200 last:border-b-0">
                    <th scope="row" className={`${td} text-left font-semibold`}>{v.user.name}, {v.user.age}<span className="block text-xs font-normal text-slate">{v.user.memberId}</span></th>
                    <td className={td}>{ago(v.createdAt)}</td>
                    <td className={td}><StatusPill status={v.status} /></td>
                    <td className={`${td} text-right`}><Link to={v.id} aria-label={`Review ${v.user.name}`} className="font-semibold underline">Review</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </>
  )
}

function CaseMedia({ id, name }: { id: string; name: string }) {
  const selfie = useBlobUrl(`/admin/verifications/${id}/selfie`)
  const voice = useBlobUrl(`/admin/verifications/${id}/voice`)
  return (
    <>
      {selfie.url ? <img src={selfie.url} alt={`Selfie submitted by ${name}`} className="max-h-96 w-full rounded-xl object-contain" />
        : <Notice tone={selfie.failed ? 'error' : 'info'}>{selfie.failed ? 'Selfie unavailable. It may have been deleted after the review.' : 'Loading selfie…'}</Notice>}
      {voice.url ? <audio controls src={voice.url} aria-label="Voice clip" className="w-full" />
        : <Notice tone={voice.failed ? 'error' : 'info'}>{voice.failed ? 'Voice clip unavailable. It may have been deleted after the review.' : 'Loading voice clip…'}</Notice>}
    </>
  )
}

export function VerificationCase() {
  const { id = '' } = useParams()
  const pending = useAdminVerificationsQuery('pending')
  const approved = useAdminVerificationsQuery('approved', { skip: !pending.isSuccess })
  const rejected = useAdminVerificationsQuery('rejected', { skip: !pending.isSuccess })
  const all = [...(pending.data ?? []), ...(approved.data ?? []), ...(rejected.data ?? [])]
  const v = all.find((x) => x.id === id)
  const done = pending.isSuccess && approved.isSuccess && rejected.isSuccess
  const [decide, { isLoading: busy }] = useDecideVerificationMutation()
  const [rejecting, setRejecting] = useState(false)
  const [error, setError] = useState('')

  async function run(arg: Parameters<typeof decide>[0]) {
    setError('')
    try { await decide(arg).unwrap(); setRejecting(false) }
    catch (e: any) { setError(e?.data?.error === 'already_decided' ? 'Someone else already decided this case.' : 'Could not save the decision.') }
  }

  const head = <PageTitle title="Verification case" back="/admin/verifications" backLabel="All verifications" />
  if (pending.isError) return <>{head}<ErrorState what="this case" onRetry={pending.refetch} /></>
  if (!v) return <>{head}{done ? <EmptyState title="Case not found"><p>It may have been removed.</p></EmptyState> : <Loading />}</>
  return (
    <>
      {head}
      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-label="Submitted media" className={`${aCard} flex flex-col gap-4`}>
          {v.status !== 'pending' || v.mediaDeleted
            ? <Notice tone="info">The selfie and voice clip were deleted after the review.</Notice>
            : <CaseMedia id={id} name={v.user.name} />}
        </section>
        <section aria-label="Member and decision" className={`${aCard} flex flex-col gap-4`}>
          <div className="flex items-center gap-3">
            <Monogram name={v.user.name} size={44} />
            <div><h2 className="font-display text-lg font-semibold">{v.user.name}, {v.user.age}</h2><StatusPill status={v.status} /></div>
          </div>
          <DL rows={[['Email', v.user.email], ['Member ID', <Link key="m" className="underline" to={`/admin/members/${v.user.memberId}`}>{v.user.memberId}</Link>], ['Submitted', dateTime(v.createdAt)]]} />
          {v.status !== 'pending' ? (
            <p className="text-sm text-slate">{v.status === 'approved' ? 'Approved' : `Rejected: ${v.reason ?? ''}`}{v.reviewedAt ? ` · ${dateTime(v.reviewedAt)}` : ''}</p>
          ) : rejecting ? (
            <RejectForm kind="verification" busy={busy} onSubmit={(reason) => run({ id: v.id, decision: 'reject', reason })} onCancel={() => setRejecting(false)} />
          ) : (
            <div className="flex flex-wrap gap-2">
              <button disabled={busy} onClick={() => run({ id: v.id, decision: 'approve' })} className={aPrimary}>Approve</button>
              <button disabled={busy} onClick={() => setRejecting(true)} className={aOutline}>Reject…</button>
            </div>
          )}
          {error && <Notice tone="error">{error}</Notice>}
        </section>
      </div>
    </>
  )
}
