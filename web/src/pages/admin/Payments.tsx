import { Fragment, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAdminPaymentsQuery, useDecidePaymentMutation, useRefundPaymentMutation, type AdminPayment, type VerificationStatus } from '../../api'
import { ago, useAdminSettingsQuery } from '../../features/admin/api'
import { dateTime, inr } from '../../format'
import { useBlobUrl } from '../../useBlobUrl'
import { EmptyState, ErrorState, Loading } from '../../components/State'
import Monogram from '../../components/Monogram'
import { PageTitle, Tabs, StatusPill, RejectForm, DL, Notice, aCard, aPrimary, aOutline, aDanger, aField, th, td } from '../../components/admin/ui'

const REFUND_ERRORS: Record<string, string> = {
  not_found: 'This payment could not be found.',
  not_approved: 'Only approved payments can be refunded.',
  too_much: 'That is more than is left to refund on this payment.',
  too_many_requests: 'That is more requests than the member has left, or than remain on this payment.',
  invalid_input: 'Check the amount, the requests and the note, then try again.',
}

function RefundBox({ p }: { p: AdminPayment }) {
  const r = p.refund!
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [rupees, setRupees] = useState((r.suggestedPaise / 100).toFixed(r.suggestedPaise % 100 ? 2 : 0))
  const [reqs, setReqs] = useState(String(r.suggestedRequests))
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [refund, { isLoading: busy }] = useRefundPaymentMutation()
  const maxReqs = Math.max(0, Math.min(r.balance, r.remainingRequests))
  const amount = Math.round(Number(rupees) * 100)
  const n = Number(reqs)

  function check(e: React.FormEvent) {
    e.preventDefault(); setError('')
    if (!Number.isFinite(amount) || amount < 1) return setError('Enter an amount of at least ₹1.')
    if (amount > r.remainingPaise) return setError(`The most you can refund is ${inr(r.remainingPaise)}.`)
    if (!Number.isInteger(n) || n < 0) return setError('Requests must be a whole number, 0 or more.')
    if (n > maxReqs) return setError(`You can take back at most ${maxReqs} requests.`)
    if (!note.trim()) return setError('Add a short note about why.')
    setConfirm(true)
  }
  async function go() {
    setError('')
    try { await refund({ id: p.id, amountPaise: amount, requests: n, note: note.trim() }).unwrap(); setOpen(false); setConfirm(false) }
    catch (e: any) { setConfirm(false); setError(REFUND_ERRORS[e?.data?.error] ?? 'Could not record the refund. Try again.') }
  }
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={`${aOutline} min-h-9 px-3 text-[13px]`}>Refund</button>
  return (
    <form onSubmit={check} className="mt-2 flex flex-col gap-3 rounded-xl bg-paper p-3 text-left">
      <p className="text-sm">This records the refund and removes the requests from the member's balance. Send the money back to the member's UPI yourself.</p>
      <label className="flex flex-col gap-1 text-sm font-semibold">Amount to refund, in rupees (up to {inr(r.remainingPaise)})
        <input type="number" min={1} max={r.remainingPaise / 100} step="0.01" required value={rupees} disabled={confirm} onChange={(e) => setRupees(e.target.value)} className={`${aField} font-normal`} /></label>
      <label className="flex flex-col gap-1 text-sm font-semibold">Requests to take back (up to {maxReqs}, member has {r.balance})
        <input type="number" min={0} max={maxReqs} step={1} required value={reqs} disabled={confirm} onChange={(e) => setReqs(e.target.value)} className={`${aField} font-normal`} /></label>
      <label className="flex flex-col gap-1 text-sm font-semibold">Note (required)
        <textarea required maxLength={300} rows={2} value={note} disabled={confirm} onChange={(e) => setNote(e.target.value)} className={`${aField} font-normal`} /></label>
      {error && <Notice tone="error">{error}</Notice>}
      {confirm ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">Record a refund of {inr(amount)} and take back {n} requests from {p.user.name}?</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={go} className={aDanger}>{busy ? 'Saving…' : 'Yes, record refund'}</button>
            <button type="button" disabled={busy} onClick={() => setConfirm(false)} className={aOutline}>Go back</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button className={aPrimary}>Review refund</button>
          <button type="button" onClick={() => { setOpen(false); setError('') }} className={aOutline}>Cancel</button>
        </div>
      )}
    </form>
  )
}

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
                  <Fragment key={p.id}>
                  <tr className="border-b border-stone-200 last:border-b-0">
                    <th scope="row" className={`${td} text-left font-semibold`}>{p.user.name}<span className="block text-xs font-normal text-slate">{p.user.memberId}</span></th>
                    <td className={td}>{p.requests} requests</td>
                    <td className={td}>{inr(p.amountPaise)}</td>
                    <td className={td}>{ago(p.createdAt)}</td>
                    <td className={td}><StatusPill status={p.status} /></td>
                    <td className={`${td} text-right`}><Link to={p.id} aria-label={`Review payment from ${p.user.name}`} className="font-semibold underline">Review</Link></td>
                  </tr>
                  {tab === 'approved' && p.refund && (p.refund.refundedPaise > 0 || p.refund.remainingPaise > 0) && (
                    <tr key={`${p.id}-r`} className="border-b border-stone-200 last:border-b-0">
                      <td colSpan={6} className="px-3 pb-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-slate">{p.refund.refundedPaise > 0 ? `Refunded ${inr(p.refund.refundedPaise)}, ${p.refund.refundedRequests} requests taken back` : 'No refunds yet'}</span>
                          {p.refund.remainingPaise > 0 && <RefundBox p={p} />}
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
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
            ['Member ID', <Link key="m" className="underline" to={`/admin/members/${p.user.memberId}`}>{p.user.memberId}</Link>], ['Submitted', dateTime(p.createdAt)],
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
