import { useEffect, useState, type FormEvent } from 'react'
import { useAdminSettingsQuery, useSaveAdminSettingsMutation, type AdminSettings } from '../../features/admin/api'
import { PageFade, Stagger } from '../../components/motion'
import { ErrorState, Loading } from '../../components/State'
import { PageTitle, Notice, aCard, aField, aPrimary } from '../../components/admin/ui'

type Form = { packs: Array<{ id: 'pack10' | 'pack20'; requests: string; rupees: string }>; payeeName: string; upiId: string; verification: string; payment: string; supportEmail: string; supportWhatsapp: string; grievanceName: string; grievanceEmail: string }

const toForm = (s: AdminSettings): Form => ({
  packs: s.packs.map((p) => ({ id: p.id, requests: String(p.requests), rupees: String(p.amountPaise / 100) })),
  payeeName: s.payee.name ?? '', upiId: s.payee.upiId ?? '',
  verification: s.quickReasons.verification.join('\n'), payment: s.quickReasons.payment.join('\n'),
  supportEmail: s.supportEmail ?? '', supportWhatsapp: s.supportWhatsapp ?? '', grievanceName: s.grievanceName ?? '', grievanceEmail: s.grievanceEmail ?? '',
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
      const r = await save({ ...data, packs, payee: { name: f.payeeName.trim() || null, upiId: f.upiId.trim() || null }, quickReasons: { verification: v, payment: p }, supportEmail: f.supportEmail.trim(), supportWhatsapp: f.supportWhatsapp.trim(), grievanceName: f.grievanceName.trim(), grievanceEmail: f.grievanceEmail.trim() }).unwrap()
      setF(toForm(r)); setMsg({ ok: true, text: 'Saved. Price changes apply to new purchases only.' })
    } catch (e: any) {
      setMsg({ ok: false, text: e?.data?.error === 'invalid_input' ? 'Check the values. The support email must be a valid address, and the WhatsApp number must have 8 to 15 digits.' : 'Could not save settings. Check the values and try again.' })
    }
  }
  const setPack = (i: number, k: 'requests' | 'rupees', v: string) => setF({ ...f, packs: f.packs.map((p, j) => (j === i ? { ...p, [k]: v } : p)) })

  return (
    <PageFade>
      <PageTitle title="Settings" sub="Packs, payee and quick reasons." />
      <Stagger as="div" className="max-w-3xl"><form onSubmit={submit} className="flex flex-col gap-6">
        <fieldset className={`${aCard} p-6 flex flex-col gap-4`}>
          <legend className="sr-only">Packs</legend>
          <h2 className="font-display text-xl">Packs</h2>
          {f.packs.map((p, i) => (
            <div key={p.id} className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-medium">{p.id === 'pack10' ? 'Pack 1' : 'Pack 2'} requests
                <input type="number" min={1} max={500} value={p.requests} onChange={(e) => setPack(i, 'requests', e.target.value)} className={`${aField} font-normal`} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">{p.id === 'pack10' ? 'Pack 1' : 'Pack 2'} price (₹)
                <input type="number" min={1} step="any" value={p.rupees} onChange={(e) => setPack(i, 'rupees', e.target.value)} className={`${aField} font-normal`} />
              </label>
            </div>
          ))}
        </fieldset>
        <fieldset className={`${aCard} p-6 grid gap-3 sm:grid-cols-2`}>
          <legend className="sr-only">Payee</legend>
          <h2 className="font-display text-xl sm:col-span-2">Payee</h2>
          <label className="flex flex-col gap-1 text-sm font-medium">Payee name<input value={f.payeeName} onChange={(e) => setF({ ...f, payeeName: e.target.value })} maxLength={80} className={`${aField} font-normal`} /></label>
          <label className="flex flex-col gap-1 text-sm font-medium">UPI ID<input value={f.upiId} onChange={(e) => setF({ ...f, upiId: e.target.value })} maxLength={80} className={`${aField} font-normal`} /></label>
        </fieldset>
        <fieldset className={`${aCard} p-6 grid gap-3 sm:grid-cols-2`}>
          <legend className="sr-only">Quick reasons</legend>
          <h2 className="font-display text-xl sm:col-span-2">Quick reasons</h2>
          <label className="flex flex-col gap-1 text-sm font-medium">Verification (one per line)<textarea rows={5} value={f.verification} onChange={(e) => setF({ ...f, verification: e.target.value })} className={`${aField} font-normal`} /></label>
          <label className="flex flex-col gap-1 text-sm font-medium">Payment (one per line)<textarea rows={5} value={f.payment} onChange={(e) => setF({ ...f, payment: e.target.value })} className={`${aField} font-normal`} /></label>
        </fieldset>
        <fieldset className={`${aCard} p-6 grid gap-3 sm:grid-cols-2`}>
          <legend className="sr-only">Support contact</legend>
          <h2 className="font-display text-xl sm:col-span-2">Support contact</h2>
          <label className="flex flex-col gap-1 text-sm font-medium">Support email<input type="email" value={f.supportEmail} onChange={(e) => setF({ ...f, supportEmail: e.target.value })} maxLength={120} className={`${aField} font-normal`} /></label>
          <label className="flex flex-col gap-1 text-sm font-medium">WhatsApp number<input type="tel" inputMode="tel" value={f.supportWhatsapp} onChange={(e) => setF({ ...f, supportWhatsapp: e.target.value })} maxLength={24} placeholder="+91 98765 43210" className={`${aField} font-normal`} /></label>
          <p className="text-[13px] text-slate sm:col-span-2">Shown to members on the site. Leave empty to hide.</p>
        </fieldset>
        <fieldset className={`${aCard} p-6 grid gap-3 sm:grid-cols-2`}>
          <legend className="sr-only">Grievance officer</legend>
          <h2 className="font-display text-xl sm:col-span-2">Grievance officer</h2>
          <label className="flex flex-col gap-1 text-sm font-medium">Name<input value={f.grievanceName} onChange={(e) => setF({ ...f, grievanceName: e.target.value })} maxLength={80} className={`${aField} font-normal`} /></label>
          <label className="flex flex-col gap-1 text-sm font-medium">Email<input type="email" value={f.grievanceEmail} onChange={(e) => setF({ ...f, grievanceEmail: e.target.value })} maxLength={120} className={`${aField} font-normal`} /></label>
          <p className="text-[13px] text-slate sm:col-span-2">The person members can complain to. Indian IT rules expect a named officer, so set this before you open to the public. Shown on the site footer and the Staying safe page. Leave empty to hide.</p>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={saving} className={aPrimary}>{saving ? 'Saving…' : 'Save'}</button>
          {msg && <Notice tone={msg.ok ? 'info' : 'error'}>{msg.text}</Notice>}
        </div>
      </form></Stagger>
    </PageFade>
  )
}
