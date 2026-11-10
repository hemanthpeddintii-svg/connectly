import { useState, type FormEvent } from 'react'
import {
  useAdminCampaignsQuery, useAdminGrowthQuery, useAdminWaitlistQuery, useCreateCampaignMutation, useDeleteCampaignMutation, useUpdateCampaignMutation,
  PLATFORMS, fmtDate, inr, shareLink, type Campaign, type CampaignInput,
} from '../../features/admin/launch'
import { ErrorState, Loading } from '../../components/State'
import { PageTitle, Notice, aCard, aDanger, aDark, aField, aOutline, aPrimary, th, td } from '../../components/admin/ui'

const h2 = 'font-display text-lg font-semibold'
type F = { name: string; platform: string; topic: string; notes: string; rupees: string; postedAt: string }
const blank: F = { name: '', platform: 'Instagram', topic: '', notes: '', rupees: '', postedAt: '' }
const toF = (c: Campaign): F => ({ name: c.name, platform: c.platform, topic: c.topic ?? '', notes: c.notes ?? '', rupees: c.costPaise != null ? String(c.costPaise / 100) : '', postedAt: c.postedAt ? c.postedAt.slice(0, 10) : '' })

function CampaignForm({ initial, busy, label, onSubmit, onCancel }: { initial: F; busy: boolean; label: string; onSubmit: (i: CampaignInput) => Promise<void>; onCancel?: () => void }) {
  const [f, setF] = useState<F>(initial)
  const [err, setErr] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('')
    const rupees = f.rupees.trim() ? Number(f.rupees) : undefined
    if (!f.name.trim()) { setErr('Give the campaign a name.'); return }
    if (rupees !== undefined && (!(rupees >= 0) || !Number.isFinite(rupees))) { setErr('Cost must be a number, 0 or more.'); return }
    const input: CampaignInput = {
      name: f.name.trim(), platform: f.platform, topic: f.topic.trim(), notes: f.notes.trim(),
      ...(rupees !== undefined ? { costPaise: Math.round(rupees * 100) } : {}),
      ...(f.postedAt ? { postedAt: new Date(`${f.postedAt}T00:00:00`).toISOString() } : {}),
    }
    try { await onSubmit(input); if (!onCancel) setF(blank) } catch { setErr('Could not save. Check the details and try again.') }
  }
  const set = (k: keyof F) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-sm font-semibold">Name<input value={f.name} maxLength={80} placeholder="e.g. Launch reel" onChange={set('name')} className={`${aField} font-normal`} /></label>
      <label className="flex flex-col gap-1 text-sm font-semibold">Platform<select value={f.platform} onChange={set('platform')} className={`${aField} font-normal`}>{PLATFORMS.map((p) => <option key={p}>{p}</option>)}</select></label>
      <label className="flex flex-col gap-1 text-sm font-semibold">Topic<input value={f.topic} maxLength={80} onChange={set('topic')} className={`${aField} font-normal`} /></label>
      <label className="flex flex-col gap-1 text-sm font-semibold">Cost in rupees<input type="number" min={0} step="any" inputMode="decimal" value={f.rupees} onChange={set('rupees')} className={`${aField} font-normal`} /></label>
      <label className="flex flex-col gap-1 text-sm font-semibold">Posted on<input type="date" value={f.postedAt} onChange={set('postedAt')} className={`${aField} font-normal`} /></label>
      <label className="flex flex-col gap-1 text-sm font-semibold">Notes<input value={f.notes} maxLength={300} onChange={set('notes')} className={`${aField} font-normal`} /></label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button disabled={busy} className={aPrimary}>{busy ? 'Saving…' : label}</button>
        {onCancel && <button type="button" onClick={onCancel} className={aOutline}>Cancel</button>}
        {err && <Notice tone="error">{err}</Notice>}
      </div>
    </form>
  )
}

function CampaignCard({ c }: { c: Campaign }) {
  const [update, { isLoading }] = useUpdateCampaignMutation()
  const [del, { isLoading: deleting }] = useDeleteCampaignMutation()
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState(false)
  async function copy() {
    try { await navigator.clipboard.writeText(shareLink(c.code)); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ }
  }
  async function remove() { setErr(false); try { await del(c.id).unwrap() } catch { setErr(true) } }
  if (editing) return <li className={aCard}><CampaignForm initial={toF(c)} busy={isLoading} label="Save changes" onCancel={() => setEditing(false)} onSubmit={async (i) => { await update({ id: c.id, ...i }).unwrap(); setEditing(false) }} /></li>
  return (
    <li className={`${aCard} flex flex-col gap-3`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0"><h3 className="break-words font-display text-base font-semibold">{c.name}</h3>
          <p className="text-[13px] text-slate">{c.platform}{c.topic ? ` · ${c.topic}` : ''} · Posted {fmtDate(c.postedAt)}</p></div>
        <span className="rounded-full bg-mist px-2.5 py-1 font-mono text-xs font-semibold">{c.code}</span>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-sm sm:grid-cols-6">
        {([['Clicks', c.clicks], ['Sign-ups', c.signups], ['Verified', c.verified], ['Women', c.women], ['Men', c.men], ['Cost per verified', inr(c.costPerVerifiedPaise)]] as const).map(([k, v]) => (
          <div key={k} className="rounded-xl bg-paper p-2.5"><dt className="text-xs text-slate">{k}</dt><dd className="font-display text-lg font-semibold">{v}</dd></div>
        ))}
      </dl>
      <p className="text-[13px] text-slate">Cost {inr(c.costPaise)}{c.notes ? ` · ${c.notes}` : ''}</p>
      {confirm ? (
        <div role="alertdialog" aria-label="Confirm delete" className="flex flex-col gap-2 rounded-xl bg-paper p-3">
          <p className="text-sm">Delete "{c.name}"? Its link will stop counting. This cannot be undone.</p>
          <div className="flex gap-2"><button type="button" disabled={deleting} onClick={remove} className={aDanger}>Delete</button><button type="button" onClick={() => setConfirm(false)} className={aOutline}>Cancel</button></div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={copy} className={aDark}>{copied ? 'Copied' : 'Copy link'}</button>
          <button type="button" onClick={() => setEditing(true)} className={aOutline}>Edit</button>
          <button type="button" onClick={() => setConfirm(true)} className={aOutline}>Delete</button>
        </div>
      )}
      {err && <Notice tone="error">Could not delete. Try again.</Notice>}
    </li>
  )
}

function Campaigns() {
  const { data, isLoading, isError, refetch } = useAdminCampaignsQuery()
  const [create, { isLoading: busy }] = useCreateCampaignMutation()
  return (
    <section aria-labelledby="cp-title" className="flex flex-col gap-4">
      <h2 id="cp-title" className={h2}>Campaigns</h2>
      <div className={aCard}><h3 className="mb-3 text-sm font-semibold text-slate">Add a campaign</h3><CampaignForm initial={blank} busy={busy} label="Add campaign" onSubmit={async (i) => { await create(i).unwrap() }} /></div>
      {isLoading ? <Loading /> : isError || !data ? <ErrorState what="campaigns" onRetry={refetch} />
        : data.campaigns.length === 0 ? <p className="text-sm text-slate">No campaigns yet. Add one to get a tracked link.</p>
        : <ul className="flex flex-col gap-3">{data.campaigns.map((c) => <CampaignCard key={c.id} c={c} />)}</ul>}
    </section>
  )
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function Rollups() {
  const { data, isLoading, isError, refetch } = useAdminGrowthQuery()
  if (isLoading) return <Loading />
  if (isError || !data) return <ErrorState what="the rollups" onRetry={refetch} />
  const days = DAYS.map((d, i) => ({ d, ...(data.byWeekday.find((w) => w.weekday === i) ?? { signups: 0, verifiedWomen: 0 }) }))
  const max = Math.max(1, ...days.map((x) => x.signups))
  return (
    <section aria-labelledby="ro-title" className={`${aCard} flex flex-col gap-5`}>
      <h2 id="ro-title" className={h2}>Rollups</h2>
      <div className="flex flex-col gap-2"><h3 className="text-sm font-semibold text-slate">By platform</h3>
        {data.byPlatform.length === 0 ? <p className="text-sm text-slate">Nothing yet.</p> : (
          <div className="overflow-x-auto rounded-xl border border-stone-200"><table className="w-full min-w-[34rem]">
            <thead><tr><th className={th}>Platform</th><th className={th}>Campaigns</th><th className={th}>Clicks</th><th className={th}>Sign-ups</th><th className={th}>Verified</th><th className={th}>Women</th><th className={th}>Men</th></tr></thead>
            <tbody className="divide-y divide-stone-200">{data.byPlatform.map((p) => <tr key={p.platform}><td className={`${td} font-semibold`}>{p.platform}</td><td className={td}>{p.campaigns}</td><td className={td}>{p.clicks}</td><td className={td}>{p.signups}</td><td className={td}>{p.verified}</td><td className={td}>{p.women}</td><td className={td}>{p.men}</td></tr>)}</tbody></table></div>)}</div>
      <div className="flex flex-col gap-2"><h3 className="text-sm font-semibold text-slate">Sign-ups by weekday</h3>
        <ul className="grid grid-cols-7 gap-1.5">{days.map((x) => (
          <li key={x.d} className="flex flex-col items-center gap-1 text-xs"><span className="font-semibold">{x.signups}</span>
            <div className="flex h-20 w-full items-end"><div className="w-full rounded-t-sm bg-ember" style={{ height: `${Math.max(x.signups ? 6 : 1, (x.signups / max) * 100)}%`, opacity: x.signups ? 1 : 0.25 }} /></div>
            <span className="text-slate">{x.d}</span><span className="text-slate" title="Verified women">{x.verifiedWomen}w</span></li>))}</ul>
        <p className="text-xs text-slate">The small number under each day is verified women.</p></div>
    </section>
  )
}

function Waitlist() {
  const { data, isLoading, isError, refetch } = useAdminWaitlistQuery()
  if (isLoading) return <Loading />
  if (isError || !data) return <ErrorState what="the waitlist" onRetry={refetch} />
  const g = data.byGender
  return (
    <section aria-labelledby="wl-title" className={`${aCard} flex flex-col gap-4`}>
      <h2 id="wl-title" className={h2}>Waitlist</h2>
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {([['Total', data.total], ['Women', g.women], ['Men', g.men], ['Other', g.other]] as const).map(([k, v]) => <li key={k} className="rounded-xl bg-paper p-3"><span className="text-[13px] text-slate">{k}</span><p className="font-display text-2xl font-semibold">{v}</p></li>)}
      </ul>
      {data.byCity.length > 0 && <div className="flex flex-col gap-1.5"><h3 className="text-sm font-semibold text-slate">By city</h3>
        <ul className="flex flex-wrap gap-2">{data.byCity.map((c) => <li key={c.city} className="rounded-full bg-mist px-3 py-1 text-[13px] font-medium">{c.city || 'Unknown'} · {c.count}</li>)}</ul></div>}
      <div className="flex flex-col gap-2"><h3 className="text-sm font-semibold text-slate">Recent</h3>
        {data.recent.length === 0 ? <p className="text-sm text-slate">No one yet.</p> : (
          <div className="overflow-x-auto rounded-xl border border-stone-200"><table className="w-full min-w-[32rem]">
            <thead><tr><th className={th}>Email</th><th className={th}>City</th><th className={th}>Gender</th><th className={th}>Source</th><th className={th}>Joined</th></tr></thead>
            <tbody className="divide-y divide-stone-200">{data.recent.map((r, i) => <tr key={r.email + i}><td className={`${td} break-all`}>{r.email}</td><td className={td}>{r.city || '—'}</td><td className={`${td} capitalize`}>{r.gender || '—'}</td><td className={td}>{r.source || '—'}</td><td className={td}>{fmtDate(r.createdAt)}</td></tr>)}</tbody></table></div>)}</div>
    </section>
  )
}

export default function Growth() {
  return (
    <>
      <PageTitle title="Growth" sub="Campaign links, what they bring in, and the waitlist." />
      <div className="flex flex-col gap-6"><Campaigns /><Rollups /><Waitlist /></div>
    </>
  )
}
