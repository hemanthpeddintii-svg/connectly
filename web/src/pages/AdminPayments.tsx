import { useState } from 'react'
import { useAdminPaymentsQuery, useDecidePaymentMutation, type AdminPayment, type VerificationStatus } from '../api'
import { dateTime, inr } from '../format'
import { useBlobUrl } from '../useBlobUrl'

function PaymentCase({ p }: { p: AdminPayment }) {
  const [decide, { isLoading }] = useDecidePaymentMutation()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const proof = useBlobUrl(`/admin/payments/${p.id}/proof`)

  async function run(arg: Parameters<typeof decide>[0]) {
    setError('')
    try { await decide(arg).unwrap() }
    catch (e: any) { setError(e?.data?.error === 'already_decided' ? 'Someone else already decided this payment.' : 'Could not save the decision.') }
  }

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4">
      <header>
        <h3 className="font-semibold">{p.user.name} · {inr(p.amountPaise)} <span className="font-normal text-stone-500">({p.requests} requests)</span></h3>
        <p className="text-sm text-stone-500">{p.user.email} · ID {p.user.bumpId} · {dateTime(p.createdAt)}</p>
        <p className="text-sm">Reference: <code className="select-all">{p.reference}</code></p>
      </header>
      {proof.url ? <img src={proof.url} alt="Payment proof" className="max-h-96 rounded-md object-contain" />
        : <p className="text-sm text-stone-500">{proof.failed ? 'Proof unavailable' : 'Loading proof…'}</p>}
      {p.status !== 'pending' ? (
        <p className="text-sm text-stone-600">
          {p.status === 'approved' ? 'Approved' : `Rejected: ${p.reason}`}{p.reviewedAt ? ` · ${dateTime(p.reviewedAt)}` : ''}
        </p>
      ) : rejecting ? (
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); run({ id: p.id, decision: 'reject', reason }) }}>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required autoFocus
            placeholder="Reason shown to the member" className="rounded-md border border-stone-300 px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <button disabled={isLoading || !reason.trim()} className="rounded-md bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-50">Confirm reject</button>
            <button type="button" onClick={() => setRejecting(false)} className="rounded-md border border-stone-300 px-3 py-2 text-sm">Cancel</button>
          </div>
        </form>
      ) : (
        <div className="flex gap-2">
          <button disabled={isLoading} onClick={() => run({ id: p.id, decision: 'approve' })}
            className="rounded-md bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-50">Add {p.requests} requests</button>
          <button disabled={isLoading} onClick={() => setRejecting(true)}
            className="rounded-md border border-stone-300 px-3 py-2 text-sm disabled:opacity-50">Reject…</button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </article>
  )
}

export default function PaymentQueue() {
  const [tab, setTab] = useState<VerificationStatus>('pending')
  const { data, isLoading, isError, refetch } = useAdminPaymentsQuery(tab)
  const tabCls = (t: VerificationStatus) => `rounded-md px-3 py-1.5 text-sm ${tab === t ? 'bg-stone-900 text-white' : 'border border-stone-300'}`
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {(['pending', 'approved', 'rejected'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={tabCls(t)}>{t[0]!.toUpperCase() + t.slice(1)}</button>
        ))}
      </div>
      {isLoading && <p className="text-stone-500">Loading…</p>}
      {isError && <p>Couldn't load payments. <button className="underline" onClick={refetch}>Retry</button></p>}
      {data?.length === 0 && <p className="text-stone-500">No {tab} payments.</p>}
      {data?.map((p) => <PaymentCase key={p.id} p={p} />)}
    </div>
  )
}
