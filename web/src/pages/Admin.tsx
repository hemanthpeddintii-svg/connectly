import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import {
  useAdminVerificationsQuery, useDecideVerificationMutation, useMeQuery,
  type AdminVerification, type VerificationStatus,
} from '../api'
import { useBlobUrl } from '../useBlobUrl'
import PaymentQueue from './AdminPayments'
import AdminReports from '../features/safety/AdminReports'

function Media({ id }: { id: string }) {
  const selfie = useBlobUrl(`/admin/verifications/${id}/selfie`)
  const voice = useBlobUrl(`/admin/verifications/${id}/voice`)
  return (
    <div className="flex flex-col gap-3">
      {selfie.url ? <img src={selfie.url} alt="Submitted selfie" className="max-h-72 rounded-md object-contain" />
        : <p className="text-sm text-stone-500">{selfie.failed ? 'Selfie unavailable' : 'Loading selfie…'}</p>}
      {voice.url ? <audio controls src={voice.url} className="w-full" />
        : <p className="text-sm text-stone-500">{voice.failed ? 'Voice clip unavailable' : 'Loading voice clip…'}</p>}
    </div>
  )
}

function Case({ v }: { v: AdminVerification }) {
  const [decide, { isLoading }] = useDecideVerificationMutation()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  async function run(p: Parameters<typeof decide>[0]) {
    setError('')
    try { await decide(p).unwrap() }
    catch (e: any) { setError(e?.data?.error === 'already_decided' ? 'Someone else already decided this case.' : 'Could not save the decision.') }
  }

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4">
      <header>
        <h3 className="font-semibold">{v.user.name}, {v.user.age}</h3>
        <p className="text-sm text-stone-500">{v.user.email} · ID {v.user.bumpId} · {new Date(v.createdAt).toLocaleString()}</p>
      </header>
      <Media id={v.id} />
      {v.status !== 'pending' ? (
        <p className="text-sm text-stone-600">
          {v.status === 'approved' ? 'Approved' : `Rejected: ${v.reason}`}
          {v.reviewedAt ? ` · ${new Date(v.reviewedAt).toLocaleString()}` : ''}
        </p>
      ) : rejecting ? (
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); run({ id: v.id, decision: 'reject', reason }) }}>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required autoFocus
            placeholder="Reason shown to the user" className="rounded-md border border-stone-300 px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <button disabled={isLoading || !reason.trim()} className="rounded-md bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-50">Confirm reject</button>
            <button type="button" onClick={() => setRejecting(false)} className="rounded-md border border-stone-300 px-3 py-2 text-sm">Cancel</button>
          </div>
        </form>
      ) : (
        <div className="flex gap-2">
          <button disabled={isLoading} onClick={() => run({ id: v.id, decision: 'approve' })}
            className="rounded-md bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-50">Approve</button>
          <button disabled={isLoading} onClick={() => setRejecting(true)}
            className="rounded-md border border-stone-300 px-3 py-2 text-sm disabled:opacity-50">Reject…</button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </article>
  )
}

function VerificationQueue() {
  const { data: me } = useMeQuery()
  const [tab, setTab] = useState<VerificationStatus>('pending')
  const { data, isLoading, isError, refetch } = useAdminVerificationsQuery(tab, { skip: me?.role !== 'admin' })
  if (me && me.role !== 'admin') return <Navigate to="/wall" replace />
  const tabCls = (t: VerificationStatus) =>
    `rounded-md px-3 py-1.5 text-sm ${tab === t ? 'bg-stone-900 text-white' : 'border border-stone-300'}`
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {(['pending', 'approved', 'rejected'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={tabCls(t)}>{t[0]!.toUpperCase() + t.slice(1)}</button>
        ))}
      </div>
      {isLoading && <p className="text-stone-500">Loading…</p>}
      {isError && <p>Couldn't load the queue. <button className="underline" onClick={refetch}>Retry</button></p>}
      {data?.length === 0 && <p className="text-stone-500">Nothing {tab}.</p>}
      {data?.map((v) => <Case key={v.id} v={v} />)}
    </div>
  )
}

type Section = 'verifications' | 'payments' | 'reports'

export default function Admin() {
  const { data: me } = useMeQuery()
  const [section, setSection] = useState<Section>('verifications')
  if (me && me.role !== 'admin') return <Navigate to="/wall" replace />
  if (!me) return <p className="text-stone-500">Loading…</p>
  const cls = (s: Section) => `border-b-2 px-1 pb-1 text-sm font-medium ${section === s ? 'border-stone-900' : 'border-transparent text-stone-500'}`
  return (
    <div className="flex flex-col gap-4">
      <nav className="flex gap-4 border-b border-stone-200">
        <button className={cls('verifications')} onClick={() => setSection('verifications')}>Verifications</button>
        <button className={cls('payments')} onClick={() => setSection('payments')}>Payments</button>
        <button className={cls('reports')} onClick={() => setSection('reports')}>Reports</button>
      </nav>
      {section === 'verifications' ? <VerificationQueue /> : section === 'payments' ? <PaymentQueue /> : <AdminReports />}
    </div>
  )
}
