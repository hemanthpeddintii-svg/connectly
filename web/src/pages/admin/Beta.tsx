import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  useAdminInvitesQuery, useAdminSettingsQuery, useBetaMetricsQuery, useCreateInvitesMutation, useSaveAdminSettingsMutation,
  useDeleteInviteMutation, useDeleteUnusedInvitesMutation,
  type AdminSettings, type BetaMetrics,
} from '../../features/admin/api'
import { ErrorState, Loading } from '../../components/State'
import { PageTitle, Notice, aCard, aDanger, aField, aOutline, aPrimary, th, td } from '../../components/admin/ui'

const pct = (n: number) => `${Math.round(n * 100)}%`

function Chip({ pass }: { pass: boolean }) {
  return <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold ${pass ? 'bg-verified/15 text-verified' : 'bg-ember/15 text-ember-deep'}`}>{pass ? 'Pass' : 'Not yet'}</span>
}

function Bar({ label, value, target, pass, note }: { label: string; value: number; target: number; pass: boolean; note?: string }) {
  const w = Math.min(100, Math.round((value / target) * 100))
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 text-sm"><span className="font-semibold">{label}</span><Chip pass={pass} /></div>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(value, target)} className="h-2.5 overflow-hidden rounded-full bg-mist">
        <div className={`h-full rounded-full ${pass ? 'bg-verified' : 'bg-ember'}`} style={{ width: `${w}%` }} />
      </div>
      {note && <p className="text-[13px] text-slate">{note}</p>}
    </div>
  )
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return <li className={`${aCard} flex flex-col gap-1`}><h3 className="text-sm font-semibold text-slate">{label}</h3><p className="font-display text-3xl font-semibold">{children}</p></li>
}

function Metrics({ m }: { m: BetaMetrics }) {
  const r = m.requests
  return (
    <section aria-labelledby="metrics-title" className="mb-8 flex flex-col gap-4">
      <h2 id="metrics-title" className="font-display text-lg font-semibold">Metrics</h2>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Women">{m.members.women}<span className="text-sm font-medium text-slate"> / {m.caps.women}</span></Stat>
        <Stat label="Men">{m.members.men}<span className="text-sm font-medium text-slate"> / {m.caps.men}</span></Stat>
        <Stat label="Verified women">{m.members.verifiedWomen}</Stat>
        <Stat label="Verified men">{m.members.verifiedMen}</Stat>
      </ul>
      <div className={`${aCard} flex flex-col gap-5`}>
        <h3 className="font-display text-base font-semibold">Gates</h3>
        <Bar label="Verified women toward 20" value={m.members.verifiedWomen} target={20} pass={m.gates.women20} note={`${m.members.verifiedWomen} of 20`} />
        <Bar label="Verified women toward 30" value={m.members.verifiedWomen} target={30} pass={m.gates.women30} note={`${m.members.verifiedWomen} of 30`} />
        <Bar label="Acceptance rate vs 20%" value={r.acceptanceRate} target={0.2} pass={m.gates.acceptance20} note={`${pct(r.acceptanceRate)} from ${r.sent} requests`} />
        <Bar label="Acceptance rate vs 30%" value={r.acceptanceRate} target={0.3} pass={m.gates.acceptance30} note={`${pct(r.acceptanceRate)} from ${r.sent} requests`} />
        <Bar label="Friends brought toward 10" value={m.friendsBrought} target={10} pass={m.gates.friends10} note={`${m.friendsBrought} of 10`} />
      </div>
      <ul className="grid gap-3 md:grid-cols-3">
        <li className={`${aCard} text-sm`}>
          <h3 className="mb-2 font-semibold text-slate">Requests</h3>
          <p>Sent {r.sent} · Accepted {r.accepted} · Declined {r.declined} · Pending {r.pending}</p>
        </li>
        <li className={`${aCard} text-sm`}>
          <h3 className="mb-2 font-semibold text-slate">Back in week two</h3>
          <p>Women {m.returnedWeek2.women} · Men {m.returnedWeek2.men}</p>
        </li>
        <li className={`${aCard} text-sm`}>
          <h3 className="mb-2 font-semibold text-slate">Would pay ₹499 for 10</h3>
          <p>Yes {m.priceInterest.yes} · Maybe {m.priceInterest.maybe} · No {m.priceInterest.no}</p>
        </li>
      </ul>
    </section>
  )
}

function Invites() {
  const { data, isLoading, isError, refetch } = useAdminInvitesQuery()
  const [create, { isLoading: busy }] = useCreateInvitesMutation()
  const [count, setCount] = useState('5')
  const [label, setLabel] = useState('')
  const [maxUses, setMaxUses] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [copied, setCopied] = useState('')
  const [del, { isLoading: deleting }] = useDeleteInviteMutation()
  const [delUnused, { isLoading: clearing }] = useDeleteUnusedInvitesMutation()
  // Deleting asks for confirmation inside the page (not a browser pop-up, which some browsers block), and reports its
  // result next to the list, where the admin is looking, not up by the form.
  const [ask, setAsk] = useState<{ text: string; yes: () => Promise<void> } | null>(null)
  const [listMsg, setListMsg] = useState<{ ok: boolean; text: string } | null>(null)

  function remove(code: string, uses: number) {
    setListMsg(null)
    setAsk({
      text: uses > 0
        ? `Delete code ${code}? ${uses} member${uses === 1 ? '' : 's'} already joined with it and keep their accounts, but nobody new can use it.`
        : `Delete code ${code}?`,
      yes: async () => {
        try { await del(code).unwrap(); setListMsg({ ok: true, text: `Deleted ${code}.` }) }
        catch (err) {
          const e = err as { status?: number; data?: { error?: string } }
          setListMsg({ ok: false, text: e.data?.error === 'campaign_code' ? 'This code belongs to a campaign. Delete the campaign on the Growth page instead.' : e.data?.error === 'not_found' ? 'That code is already gone.' : 'Could not delete the code. Try again.' })
        }
      },
    })
  }
  function removeUnused() {
    setListMsg(null)
    const n = (data ?? []).filter((i) => i.uses === 0 && !i.owner && !i.campaign).length
    if (n === 0) { setListMsg({ ok: true, text: 'There are no unused codes to delete.' }); return }
    setAsk({
      text: `Delete ${n} unused code${n === 1 ? '' : 's'}? Codes that someone has used, member codes and campaign codes are kept.`,
      yes: async () => {
        try { const r = await delUnused().unwrap(); setListMsg({ ok: true, text: `Deleted ${r.deleted} unused code${r.deleted === 1 ? '' : 's'}.` }) }
        catch { setListMsg({ ok: false, text: 'Could not delete the codes. Try again.' }) }
      },
    })
  }

  async function submit(e: FormEvent) {
    e.preventDefault(); setMsg(null)
    const n = Number(count)
    if (!Number.isInteger(n) || n < 1 || n > 100) { setMsg({ ok: false, text: 'Make between 1 and 100 codes.' }); return }
    const mu = maxUses.trim() ? Number(maxUses) : undefined
    if (mu !== undefined && (!Number.isInteger(mu) || mu < 1)) { setMsg({ ok: false, text: 'Max uses must be a whole number of 1 or more.' }); return }
    try {
      const r = await create({ count: n, ...(label.trim() ? { label: label.trim() } : {}), ...(mu ? { maxUses: mu } : {}) }).unwrap()
      setMsg({ ok: true, text: `Made ${r.codes.length} code${r.codes.length === 1 ? '' : 's'}.` })
    } catch { setMsg({ ok: false, text: 'Could not make codes. Try again.' }) }
  }
  async function copy(code: string, link: boolean) {
    const text = link ? `${window.location.origin}/signup?invite=${encodeURIComponent(code)}` : code
    try { await navigator.clipboard.writeText(text); setCopied(code + link); setTimeout(() => setCopied(''), 1500) } catch { /* clipboard blocked */ }
  }

  return (
    <section aria-labelledby="invites-title" className="mb-8 flex flex-col gap-4">
      <h2 id="invites-title" className="font-display text-lg font-semibold">Invites</h2>
      <form onSubmit={submit} className={`${aCard} grid gap-3 sm:grid-cols-4`}>
        <label className="flex flex-col gap-1 text-sm font-semibold">How many<input type="number" min={1} max={100} value={count} onChange={(e) => setCount(e.target.value)} className={`${aField} font-normal`} /></label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Label<input value={label} maxLength={60} placeholder="e.g. Founders' friends" onChange={(e) => setLabel(e.target.value)} className={`${aField} font-normal`} /></label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Max uses each<input type="number" min={1} value={maxUses} placeholder="Default" onChange={(e) => setMaxUses(e.target.value)} className={`${aField} font-normal`} /></label>
        <div className="flex items-end"><button disabled={busy} className={`${aPrimary} w-full`}>{busy ? 'Making…' : 'Make codes'}</button></div>
        {msg && <div className="sm:col-span-4"><Notice tone={msg.ok ? 'info' : 'error'}>{msg.text}</Notice></div>}
      </form>
      {isLoading ? <Loading /> : isError || !data ? <ErrorState what="invites" onRetry={refetch} />
        : data.length === 0 ? <p className="text-sm text-slate">No codes yet.</p> : (
          <div className="flex flex-col gap-3">
          {ask && (
            <div role="alertdialog" aria-label="Confirm delete" className={`${aCard} flex flex-col gap-3`}>
              <p className="text-[15px] font-semibold">{ask.text}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={deleting || clearing} className={`${aDanger} min-h-9 px-4 text-[13px]`}
                  onClick={async () => { const run = ask.yes; setAsk(null); await run() }}>Yes, delete</button>
                <button type="button" className={`${aOutline} min-h-9 px-4 text-[13px]`} onClick={() => setAsk(null)}>Cancel</button>
              </div>
            </div>
          )}
          {listMsg && <Notice tone={listMsg.ok ? 'info' : 'error'}>{listMsg.text}</Notice>}
          <div className="flex justify-end">
            <button type="button" disabled={clearing} onClick={removeUnused} className={`${aOutline} min-h-9 px-3 text-[13px]`}>{clearing ? 'Deleting…' : 'Delete unused codes'}</button>
          </div>
          <div className="overflow-x-auto rounded-2xl bg-white">
            <table className="w-full min-w-[34rem]">
              <thead><tr><th className={th}>Code</th><th className={th}>Label</th><th className={th}>Used</th><th className={th}><span className="sr-only">Copy</span></th></tr></thead>
              <tbody className="divide-y divide-stone-200">
                {data.map((i) => (
                  <tr key={i.code}>
                    <td className={`${td} font-mono font-semibold`}>{i.code}</td>
                    <td className={td}>{i.label || '—'}</td>
                    <td className={td}>{i.uses}{i.maxUses ? ` / ${i.maxUses}` : ''}</td>
                    <td className={`${td} flex gap-2`}>
                      <button type="button" onClick={() => copy(i.code, false)} className={`${aOutline} min-h-9 px-3 text-[13px]`}>{copied === i.code + false ? 'Copied' : 'Code'}</button>
                      <button type="button" onClick={() => copy(i.code, true)} className={`${aOutline} min-h-9 px-3 text-[13px]`}>{copied === i.code + true ? 'Copied' : 'Link'}</button>
                      <button type="button" disabled={deleting || i.campaign} title={i.campaign ? 'Delete the campaign on the Growth page' : undefined} onClick={() => remove(i.code, i.uses)} className={`${aDanger} min-h-9 px-3 text-[13px] disabled:opacity-40`} aria-label={`Delete code ${i.code}`}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
        )}
    </section>
  )
}

type BForm = { inviteOnly: boolean; betaFree: boolean; betaFreeRequests: string; capWomen: string; capMen: string; betaCity: string; payCapMen: string; payCapRupees: string }
const toForm = (s: AdminSettings): BForm => ({
  inviteOnly: !!s.inviteOnly, betaFree: !!s.betaFree, betaFreeRequests: String(s.betaFreeRequests ?? ''),
  capWomen: String(s.capWomen ?? ''), capMen: String(s.capMen ?? ''), betaCity: s.betaCity ?? '',
  payCapMen: String(s.payCapMen ?? 0), payCapRupees: String(s.payCapRupees ?? 0),
})

function BetaSettings() {
  const { data, isLoading, isError, refetch } = useAdminSettingsQuery()
  const [save, { isLoading: saving }] = useSaveAdminSettingsMutation()
  const [f, setF] = useState<BForm | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => { if (data && !f) setF(toForm(data)) }, [data, f])
  if (isLoading || (!f && !isError)) return <Loading />
  if (isError || !f || !data) return <ErrorState what="beta settings" onRetry={refetch} />

  async function submit(e: FormEvent) {
    e.preventDefault(); setMsg(null)
    if (!f || !data) return
    const nums = [f.betaFreeRequests, f.capWomen, f.capMen, f.payCapMen, f.payCapRupees].map(Number)
    if (nums.some((n) => !Number.isInteger(n) || n < 0)) { setMsg({ ok: false, text: 'Requests and caps must be whole numbers, 0 or more.' }); return }
    try {
      const r = await save({ ...data, inviteOnly: f.inviteOnly, betaFree: f.betaFree, betaFreeRequests: nums[0]!, capWomen: nums[1]!, capMen: nums[2]!, betaCity: f.betaCity.trim(), payCapMen: nums[3]!, payCapRupees: nums[4]! }).unwrap()
      setF(toForm(r)); setMsg({ ok: true, text: 'Saved.' })
    } catch { setMsg({ ok: false, text: 'Could not save settings. Check the values and try again.' }) }
  }
  const toggle = 'flex min-h-11 items-center gap-3 text-sm font-semibold'
  return (
    <section aria-labelledby="bs-title" className="flex flex-col gap-4">
      <h2 id="bs-title" className="font-display text-lg font-semibold">Beta settings</h2>
      <form onSubmit={submit} className={`${aCard} grid gap-3 sm:grid-cols-2`}>
        <label className={toggle}><input type="checkbox" checked={f.inviteOnly} onChange={(e) => setF({ ...f, inviteOnly: e.target.checked })} className="h-5 w-5 accent-ink" />Invite only signup</label>
        <label className={toggle}><input type="checkbox" checked={f.betaFree} onChange={(e) => setF({ ...f, betaFree: e.target.checked })} className="h-5 w-5 accent-ink" />Free beta (no pack purchases)</label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Free requests per man<input type="number" min={0} value={f.betaFreeRequests} onChange={(e) => setF({ ...f, betaFreeRequests: e.target.value })} className={`${aField} font-normal`} /></label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Beta city<input value={f.betaCity} maxLength={60} onChange={(e) => setF({ ...f, betaCity: e.target.value })} className={`${aField} font-normal`} /></label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Cap, women<input type="number" min={0} value={f.capWomen} onChange={(e) => setF({ ...f, capWomen: e.target.value })} className={`${aField} font-normal`} /></label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Cap, men<input type="number" min={0} value={f.capMen} onChange={(e) => setF({ ...f, capMen: e.target.value })} className={`${aField} font-normal`} /></label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Stop pack sales after this many paying men (0 = no limit)<input type="number" min={0} step={1} value={f.payCapMen} onChange={(e) => setF({ ...f, payCapMen: e.target.value })} className={`${aField} font-normal`} /></label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Stop pack sales after this much in sales, in rupees (0 = no limit)<input type="number" min={0} step={1} value={f.payCapRupees} onChange={(e) => setF({ ...f, payCapRupees: e.target.value })} className={`${aField} font-normal`} /></label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button disabled={saving} className={aPrimary}>{saving ? 'Saving…' : 'Save'}</button>
          {msg && <Notice tone={msg.ok ? 'info' : 'error'}>{msg.text}</Notice>}
        </div>
      </form>
    </section>
  )
}

export default function Beta() {
  const { data, isLoading, isError, refetch } = useBetaMetricsQuery(undefined, { pollingInterval: 60000 })
  return (
    <>
      <PageTitle title="Beta" sub="Metrics, invites and beta settings." />
      {isLoading ? <Loading /> : isError || !data ? <ErrorState what="the metrics" onRetry={refetch} /> : <Metrics m={data} />}
      <Invites />
      <BetaSettings />
    </>
  )
}
