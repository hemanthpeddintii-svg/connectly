import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ago, useAdjustCreditsMutation, useAdminMemberQuery, useAdminMembersQuery } from '../../features/admin/api'
import { dateTime, dateOnly, inr } from '../../format'
import { EmptyState, ErrorState, Loading } from '../../components/State'
import Monogram from '../../components/Monogram'
import { PageTitle, StatusPill, DL, Notice, aCard, aField, aDark, aOutline, th, td } from '../../components/admin/ui'

const LIMIT = 25
const sel = `${aField} !w-auto min-h-11`

export function MemberList() {
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [role, setRole] = useState('')
  const [gender, setGender] = useState('')
  const [offset, setOffset] = useState(0)
  useEffect(() => { const t = setTimeout(() => { setQ(qInput.trim()); setOffset(0) }, 300); return () => clearTimeout(t) }, [qInput])
  const { data, isLoading, isError, refetch, isFetching } = useAdminMembersQuery({ q, status, role, gender, limit: LIMIT, offset })
  const reset = (f: (v: string) => void) => (e: { target: { value: string } }) => { f(e.target.value); setOffset(0) }
  return (
    <>
      <PageTitle title="Members" sub="Search and review every account." />
      <form role="search" onSubmit={(e: FormEvent) => e.preventDefault()} className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-sm font-semibold">Search
          <input type="search" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Name, email or ID" className={aField} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Status
          <select value={status} onChange={reset(setStatus)} className={sel}><option value="">All</option>{['unverified', 'pending', 'active', 'rejected', 'deleted', 'suspended'].map((s) => <option key={s} value={s}>{s}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Role
          <select value={role} onChange={reset(setRole)} className={sel}><option value="">All</option><option value="user">user</option><option value="admin">admin</option></select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Gender
          <select value={gender} onChange={reset(setGender)} className={sel}><option value="">All</option><option value="man">man</option><option value="woman">woman</option></select>
        </label>
      </form>
      {isLoading ? <Loading /> : isError || !data ? <ErrorState what="members" onRetry={refetch} />
        : !data.items.length ? <EmptyState title="No members match"><p>Try a different search or clear the filters.</p></EmptyState>
        : (
          <>
            <div className={`overflow-x-auto rounded-2xl bg-white ${isFetching ? 'opacity-70' : ''}`}>
              <table className="w-full min-w-[640px]">
                <caption className="sr-only">Members</caption>
                <thead><tr className="border-b border-stone-200"><th scope="col" className={th}>Member</th><th scope="col" className={th}>Status</th><th scope="col" className={th}>Role</th><th scope="col" className={th}>Gender</th><th scope="col" className={th}>Requests</th><th scope="col" className={th}>Joined</th></tr></thead>
                <tbody>
                  {data.items.map((m) => (
                    <tr key={m.bumpId} className="border-b border-stone-200 last:border-b-0">
                      <th scope="row" className={`${td} text-left`}>
                        <Link to={m.bumpId} className="font-semibold underline">{m.name}, {m.age}</Link>
                        <span className="block text-xs font-normal text-slate">{m.email}</span>
                      </th>
                      <td className={td}><StatusPill status={m.suspended ? 'suspended' : m.status} /></td>
                      <td className={td}>{m.role}</td><td className={td}>{m.gender ?? '—'}</td><td className={td}>{m.requestCredits}</td><td className={td}>{dateOnly(m.joinedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3 text-sm">
              <span role="status">{offset + 1}–{Math.min(offset + LIMIT, data.total)} of {data.total}</span>
              <span className="flex gap-2">
                <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))} className={aOutline}>Previous</button>
                <button disabled={offset + LIMIT >= data.total} onClick={() => setOffset(offset + LIMIT)} className={aOutline}>Next</button>
              </span>
            </nav>
          </>
        )}
    </>
  )
}

function Adjust({ bumpId, balance }: { bumpId: string; balance: number }) {
  const [adjust, { isLoading }] = useAdjustCreditsMutation()
  const [delta, setDelta] = useState('')
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const n = Number(delta)
  const valid = Number.isInteger(n) && n !== 0 && Math.abs(n) <= 1000 && reason.trim().length > 0
  async function submit(e: FormEvent) {
    e.preventDefault(); setMsg(null)
    try {
      const r = await adjust({ bumpId, delta: n, reason: reason.trim() }).unwrap()
      setMsg({ ok: true, text: `Balance is now ${r.requestCredits}.` }); setDelta(''); setReason('')
    } catch (err: any) {
      setMsg({ ok: false, text: err?.data?.error === 'would_go_negative' ? `That would take the balance below 0 (currently ${balance}).` : 'Could not adjust the balance.' })
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">Adjust balance</h3>
      <label className="flex flex-col gap-1 text-sm">Change (use a minus to remove)
        <input type="number" inputMode="numeric" step={1} min={-1000} max={1000} value={delta} onChange={(e) => setDelta(e.target.value)} className={aField} />
      </label>
      <label className="flex flex-col gap-1 text-sm">Reason (required)
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className={aField} />
      </label>
      <button disabled={!valid || isLoading} className={`${aDark} self-start`}>Apply</button>
      {msg && <Notice tone={msg.ok ? 'info' : 'error'}>{msg.text}</Notice>}
    </form>
  )
}

export function MemberDetail() {
  const { bumpId = '' } = useParams()
  const { data, isLoading, isError, refetch } = useAdminMemberQuery(bumpId)
  const head = <PageTitle title="Member" back="/admin/members" backLabel="All members" />
  if (isLoading) return <>{head}<Loading /></>
  if (isError || !data) return <>{head}<ErrorState what="this member" onRetry={refetch} /></>
  const { member: m, verifications, payments, audit } = data
  return (
    <>
      {head}
      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-label="Profile" className={`${aCard} flex flex-col gap-4`}>
          <div className="flex items-center gap-3">
            <Monogram name={m.name} size={52} />
            <div className="flex flex-col gap-1"><h2 className="font-display text-xl font-semibold">{m.name}, {m.age}</h2>
              <span className="flex gap-2"><StatusPill status={m.suspended ? 'suspended' : m.status} /><span className="inline-flex h-6 items-center rounded-full bg-mist px-2.5 text-xs font-semibold">{m.role}</span></span></div>
          </div>
          <DL rows={[['Member ID', m.bumpId], ['Email', m.email], ['Gender', m.gender ?? '—'], ['City', m.city || '—'], ['Looking for', m.lookingFor || '—'], ['Joined', dateTime(m.joinedAt)],
            ...(m.rejectionReason ? [['Rejection reason', m.rejectionReason] as [string, string]] : [])]} />
        </section>
        <section aria-label="Requests balance" className={`${aCard} flex flex-col gap-4`}>
          <h2 className="text-sm font-semibold text-slate">Requests balance</h2>
          <p className="font-display text-4xl font-semibold">{m.requestCredits}</p>
          <Adjust bumpId={m.bumpId} balance={m.requestCredits} />
        </section>
        <section aria-label="Verification history" className={aCard}>
          <h2 className="mb-2 font-display text-lg font-semibold">Verification history</h2>
          {!verifications.length ? <p className="text-sm text-slate">No submissions.</p> : (
            <table className="w-full"><caption className="sr-only">Verification history</caption>
              <thead><tr><th scope="col" className={th}>Submitted</th><th scope="col" className={th}>Status</th><th scope="col" className={th}>Reason</th></tr></thead>
              <tbody>{verifications.map((v) => (<tr key={v.id} className="border-t border-stone-200"><th scope="row" className={`${td} text-left font-normal`}><Link className="underline" to={`/admin/verifications/${v.id}`}>{ago(v.createdAt)}</Link></th><td className={td}><StatusPill status={v.status} /></td><td className={td}>{v.reason ?? '—'}</td></tr>))}</tbody></table>
          )}
        </section>
        <section aria-label="Payment history" className={aCard}>
          <h2 className="mb-2 font-display text-lg font-semibold">Payment history</h2>
          {!payments.length ? <p className="text-sm text-slate">No payments.</p> : (
            <table className="w-full"><caption className="sr-only">Payment history</caption>
              <thead><tr><th scope="col" className={th}>Submitted</th><th scope="col" className={th}>Pack</th><th scope="col" className={th}>Amount</th><th scope="col" className={th}>Status</th></tr></thead>
              <tbody>{payments.map((p) => (<tr key={p.id} className="border-t border-stone-200"><th scope="row" className={`${td} text-left font-normal`}><Link className="underline" to={`/admin/payments/${p.id}`}>{ago(p.createdAt)}</Link></th><td className={td}>{p.requests}</td><td className={td}>{inr(p.amountPaise)}</td><td className={td}><StatusPill status={p.status} /></td></tr>))}</tbody></table>
          )}
        </section>
        <section aria-label="Audit trail" className={`${aCard} lg:col-span-2`}>
          <h2 className="mb-2 font-display text-lg font-semibold">Audit trail</h2>
          {!audit.length ? <p className="text-sm text-slate">No admin actions on this member.</p> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[480px]"><caption className="sr-only">Audit trail</caption>
              <thead><tr><th scope="col" className={th}>When</th><th scope="col" className={th}>Action</th><th scope="col" className={th}>Detail</th><th scope="col" className={th}>By</th></tr></thead>
              <tbody>{audit.map((a) => (<tr key={a.id} className="border-t border-stone-200"><th scope="row" className={`${td} text-left font-normal`}>{dateTime(a.at)}</th><td className={td}>{a.action}</td><td className={`${td} break-words text-slate`}>{Object.entries(a.detail ?? {}).map(([k, v]) => `${k}: ${String(v)}`).join(', ') || '—'}</td><td className={td}>{a.by}</td></tr>))}</tbody></table></div>
          )}
        </section>
      </div>
    </>
  )
}
