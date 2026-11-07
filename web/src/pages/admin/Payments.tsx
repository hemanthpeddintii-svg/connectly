import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAdminPaymentsQuery, useDecidePaymentMutation, type VerificationStatus } from '../../api'
import { ago, useAdminSettingsQuery } from '../../features/admin/api'
import { dateTime, inr } from '../../format'
import { useBlobUrl } from '../../useBlobUrl'
import { EmptyState, ErrorState, Loading } from '../../components/State'
import Monogram from '../../components/Monogram'
import { PageTitle, Tabs, StatusPill, RejectForm, DL, Notice, aCard, aPrimary, aOutline, th, td } from '../../components/admin/ui'

const TABS = ['pending', 'approved', 'rejected'] as const

export function PaymentQueue() {
  const [tab, setTab] = useState<VerificationStatus>('pending')
  const { data, isLoading, isError, refetch } = useAdminPaymentsQuery(tab)
  return (
    <>
      <PageTitle title="Payments" sub="Match each proof to the amount and reference, then add the requests." />
      <Tabs label="Payment status" value={tab} options={TABS} onChange={setTab} />
      {isLoading ? <Loading /> : isError ? <ErrorState what="payments" onRetry={refetch} />
        : !data?.length ? <EmptyState title={`No ${tab} payments`}><p>New payment proofs show up here.</p></EmptyState>
        : (
          <div className="overflow-x-auto rounded-2xl bg-white">
            <table className="w-full min-w-[560px]">
              <caption className="sr-only">Payments, {tab}</caption>
              <thead><tr className="border-b border-stone-200"><th scope="col" className={th}>Member</th><th scope="col" className={th}>Pack</th><th scope="col" className={th}>Amount</th><th scope="col" className={th}>Submitted</th><th scope="col" className={th}>Status</th><th scope="col" className={th}><span className="sr-only">Open</span></th></tr></thead>
              <tbody>
                {data.map((p) => (
                  <tr key={p.id} className="border-b border-stone-200 last:border-b-0">
                    <th scope="row" className={`${td} text-left font-semibold`}>{p.user.name}<span className="block text-xs font-normal text-slate">{p.user.bumpId}</span></th>
                    <td className={td}>{p.requests} requests</td>
                    <td className={td}>{inr(p.amountPaise)}</td>
                    <td className={td}>{ago(p.createdAt)}</td>
                    <td className={td}><StatusPill status={p.status} /></td>
                    <td className={`${td} text-right`}><Link to={p.id} aria-label={`Review payment from ${p.user.name}`} className="font-semibold underline">Review</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </>
  )
}

export function PaymentCase() {
  const { id = '' } = useParams()
  const pending = useAdminPaymentsQuery('pending')
  const approved = useAdminPaymentsQuery('approved', { skip: !pending.isSuccess })
  const rejected = useAdminPaymentsQuery('rejected', { skip: !pending.isSuccess })
  const p = [...(pending.data ?? []), ...(approved.data ?? []), ...(rejected.data ?? [])].find((x) => x.id === id)
  const done = pending.isSuccess && approved.isSuccess && rejected.isSuccess
  const { data: settings } = useAdminSettingsQuery()
  const [decide, { isLoading: busy }] = useDecidePaymentMutation()
  const [rejecting, setRejecting] = useState(false)
  const [error, setError] = useState('')
  const proof = useBlobUrl(`/admin/payments/${id}/proof`)

  async function run(arg: Parameters<typeof decide>[0]) {
    setError('')
    try { await decide(arg).unwrap(); setRejecting(false) }
    catch (e: any) { setError(e?.data?.error === 'already_decided' ? 'Someone else already decided this payment.' : 'Could not save the decision.') }
  }

  const head = <PageTitle title="Payment case" back="/admin/payments" backLabel="All payments" />
  if (pending.isError) return <>{head}<ErrorState what="this payment" onRetry={pending.refetch} /></>
  if (!p) return <>{head}{done ? <EmptyState title="Payment not found"><p>It may have been removed.</p></EmptyState> : <Loading />}</>
  const pack = settings?.packs.find((k) => k.id === p.planId)
  const amountOk = pack ? pack.amountPaise === p.amountPaise : null
  const checks: Array<[string, string]> = [
    ['Amount matches the pack price', amountOk === null ? 'Checking…' : amountOk ? 'Yes' : `No, current price is ${inr(pack!.amountPaise)}`],
    ['Reference on the proof', p.reference],
    ['Payee', settings?.payee.upiId ? `${settings.payee.name ?? ''} ${settings.payee.upiId}`.trim() : 'Not set'],
  ]
  return (
    <>
      {head}
      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-label="Payment proof" className={aCard}>
          {proof.url ? <img src={proof.url} alt={`Payment proof from ${p.user.name}`} className="max-h-[32rem] w-full rounded-xl object-contain" />
            : <Notice tone={proof.failed ? 'error' : 'info'}>{proof.failed ? 'Proof unavailable.' : 'Loading proof…'}</Notice>}
        </section>
        <section aria-label="Payment and decision" className={`${aCard} flex flex-col gap-4`}>
          <div className="flex items-center gap-3">
            <Monogram name={p.user.name} size={44} />
            <div><h2 className="font-display text-lg font-semibold">{p.user.name}</h2><StatusPill status={p.status} /></div>
          </div>
          <DL rows={[
            ['Pack', `${p.requests} requests`], ['Expected amount', inr(p.amountPaise)], ['Email', p.user.email],
            ['Member ID', <Link key="m" className="underline" to={`/admin/members/${p.user.bumpId}`}>{p.user.bumpId}</Link>], ['Submitted', dateTime(p.createdAt)],
          ]} />
          <div>
            <h3 className="mb-1.5 text-sm font-semibold">Checks</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {checks.map(([k, v]) => <li key={k}><span className="text-slate">{k}: </span><span className="font-medium">{v}</span></li>)}
            </ul>
          </div>
          {p.status !== 'pending' ? (
            <p className="text-sm text-slate">{p.status === 'approved' ? 'Approved' : `Rejected: ${p.reason ?? ''}`}{p.reviewedAt ? ` · ${dateTime(p.reviewedAt)}` : ''}</p>
          ) : rejecting ? (
            <RejectForm kind="payment" busy={busy} onSubmit={(reason) => run({ id: p.id, decision: 'reject', reason })} onCancel={() => setRejecting(false)} />
          ) : (
            <div className="flex flex-wrap gap-2">
              <button disabled={busy} onClick={() => run({ id: p.id, decision: 'approve' })} className={aPrimary}>Add {p.requests} requests</button>
              <button disabled={busy} onClick={() => setRejecting(true)} className={aOutline}>Reject…</button>
            </div>
          )}
          {error && <Notice tone="error">{error}</Notice>}
        </section>
      </div>
    </>
  )
}
