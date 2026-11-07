import { useEffect, useState, type FormEvent } from 'react'
import { useAdminSettingsQuery, useSaveAdminSettingsMutation, type AdminSettings } from '../../features/admin/api'
import { ErrorState, Loading } from '../../components/State'
import { PageTitle, Notice, aCard, aField, aPrimary } from '../../components/admin/ui'

type Form = { packs: Array<{ id: 'pack10' | 'pack20'; requests: string; rupees: string }>; payeeName: string; upiId: string; verification: string; payment: string }

const toForm = (s: AdminSettings): Form => ({
  packs: s.packs.map((p) => ({ id: p.id, requests: String(p.requests), rupees: String(p.amountPaise / 100) })),
  payeeName: s.payee.name ?? '', upiId: s.payee.upiId ?? '',
  verification: s.quickReasons.verification.join('\n'), payment: s.quickReasons.payment.join('\n'),
})
const lines = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean)

export default function AdminSettingsPage() {
  const { data, isLoading, isError, refetch } = useAdminSettingsQuery()
  const [save, { isLoading: saving }] = useSaveAdminSettingsMutation()
  const [f, setF] = useState<Form | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => { if (data && !f) setF(toForm(data)) }, [data, f])

  if (isLoading || (!f && !isError)) return <><PageTitle title="Settings" /><Loading /></>
  if (isError || !f) return <><PageTitle title="Settings" /><ErrorState what="settings" onRetry={refetch} /></>

  async function submit(e: FormEvent) {
    e.preventDefault(); setMsg(null)
    if (!f) return
    const packs = f.packs.map((p) => ({ id: p.id, requests: Number(p.requests), amountPaise: Math.round(Number(p.rupees) * 100) }))
    if (packs.some((p) => !Number.isInteger(p.requests) || p.requests < 1 || p.requests > 500 || !(p.amountPaise >= 100 && p.amountPaise <= 10_000_000))) {
      setMsg({ ok: false, text: 'Requests must be 1 to 500 and price at least ₹1.' }); return
    }
    const v = lines(f.verification), p = lines(f.payment)
    if (v.length > 8 || p.length > 8 || [...v, ...p].some((x) => x.length > 80)) { setMsg({ ok: false, text: 'Use at most 8 quick reasons per list, each up to 80 characters.' }); return }
    try {
      const r = await save({ packs, payee: { name: f.payeeName.trim() || null, upiId: f.upiId.trim() || null }, quickReasons: { verification: v, payment: p } }).unwrap()
      setF(toForm(r)); setMsg({ ok: true, text: 'Saved. Price changes apply to new purchases only.' })
    } catch { setMsg({ ok: false, text: 'Could not save settings. Check the values and try again.' }) }
  }
  const setPack = (i: number, k: 'requests' | 'rupees', v: string) => setF({ ...f, packs: f.packs.map((p, j) => (j === i ? { ...p, [k]: v } : p)) })

  return (
    <>
      <PageTitle title="Settings" sub="Packs, payee and quick reasons." />
      <form onSubmit={submit} className="flex max-w-3xl flex-col gap-5">
        <fieldset className={`${aCard} flex flex-col gap-4`}>
          <legend className="sr-only">Packs</legend>
          <h2 className="font-display text-lg font-semibold">Packs</h2>
          {f.packs.map((p, i) => (
            <div key={p.id} className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-semibold">{p.id === 'pack10' ? 'Pack 1' : 'Pack 2'} requests
                <input type="number" min={1} max={500} value={p.requests} onChange={(e) => setPack(i, 'requests', e.target.value)} className={`${aField} font-normal`} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold">{p.id === 'pack10' ? 'Pack 1' : 'Pack 2'} price (₹)
                <input type="number" min={1} step="any" value={p.rupees} onChange={(e) => setPack(i, 'rupees', e.target.value)} className={`${aField} font-normal`} />
              </label>
            </div>
          ))}
        </fieldset>
        <fieldset className={`${aCard} grid gap-3 sm:grid-cols-2`}>
          <legend className="sr-only">Payee</legend>
          <h2 className="font-display text-lg font-semibold sm:col-span-2">Payee</h2>
          <label className="flex flex-col gap-1 text-sm font-semibold">Payee name<input value={f.payeeName} onChange={(e) => setF({ ...f, payeeName: e.target.value })} maxLength={80} className={`${aField} font-normal`} /></label>
          <label className="flex flex-col gap-1 text-sm font-semibold">UPI ID<input value={f.upiId} onChange={(e) => setF({ ...f, upiId: e.target.value })} maxLength={80} className={`${aField} font-normal`} /></label>
        </fieldset>
        <fieldset className={`${aCard} grid gap-3 sm:grid-cols-2`}>
          <legend className="sr-only">Quick reasons</legend>
          <h2 className="font-display text-lg font-semibold sm:col-span-2">Quick reasons</h2>
          <label className="flex flex-col gap-1 text-sm font-semibold">Verification (one per line)<textarea rows={5} value={f.verification} onChange={(e) => setF({ ...f, verification: e.target.value })} className={`${aField} font-normal`} /></label>
          <label className="flex flex-col gap-1 text-sm font-semibold">Payment (one per line)<textarea rows={5} value={f.payment} onChange={(e) => setF({ ...f, payment: e.target.value })} className={`${aField} font-normal`} /></label>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={saving} className={aPrimary}>{saving ? 'Saving…' : 'Save'}</button>
          {msg && <Notice tone={msg.ok ? 'info' : 'error'}>{msg.text}</Notice>}
        </div>
      </form>
    </>
  )
}
