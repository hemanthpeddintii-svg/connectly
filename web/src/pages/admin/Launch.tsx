import { useEffect, useState, type ReactNode } from 'react'
import {
  useAdminHealthQuery, useAdminLaunchQuery, useSaveLaunchMutation, useSetMilestoneMutation, useUsersOverviewQuery,
  fmtDate, inr, type Health, type Launch, type MilestoneGroup, type MilestoneItem, type Stage, type UsersOverview,
} from '../../features/admin/launch'
import { ErrorState, Loading } from '../../components/State'
import { PageTitle, Notice, aCard, aField, aOutline, aPrimary, aDark, th, td } from '../../components/admin/ui'

const h2 = 'font-display text-lg font-semibold'
const pct = (n: number) => `${Math.round(n * 100)}%`

function Chip({ done }: { done: boolean }) {
  return <span className={`inline-flex h-6 flex-none items-center rounded-full px-2.5 text-xs font-semibold ${done ? 'bg-verified/15 text-verified' : 'bg-ember/15 text-ember-deep'}`}>{done ? 'Done' : 'Not yet'}</span>
}
function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return <li className="flex flex-col gap-0.5 rounded-xl bg-paper p-3"><span className="text-[13px] text-slate">{label}</span><span className="font-display text-2xl font-semibold">{value}</span>{sub && <span className="text-xs text-slate">{sub}</span>}</li>
}
function Grid({ children }: { children: ReactNode }) { return <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">{children}</ul> }
const hrs = (n: number | null) => (n == null ? '—' : `${n.toFixed(1)} h`)

const STAGES: Array<{ key: Stage; label: string }> = [
  { key: 'prepare', label: 'Prepare' }, { key: 'free_beta', label: 'Free beta' },
  { key: 'gate_ready', label: 'Gate check' }, { key: 'paid_test', label: 'Paid test' },
]
const GROUPS: Array<{ key: MilestoneGroup; label: string }> = [
  { key: 'women', label: 'Women on the platform' }, { key: 'quality', label: 'Quality' }, { key: 'legal', label: 'Legal' },
  { key: 'safety', label: 'Safety' }, { key: 'ops', label: 'Operations' },
]

function ManualItem({ item }: { item: MilestoneItem }) {
  const [save, { isLoading }] = useSetMilestoneMutation()
  const [note, setNote] = useState(item.note ?? '')
  const [err, setErr] = useState(false)
  useEffect(() => setNote(item.note ?? ''), [item.note])
  async function commit(done: boolean, n = note) {
    setErr(false)
    try { await save({ key: item.key, done, note: n.trim() }).unwrap() } catch { setErr(true) }
  }
  return (
    <div className="flex flex-col gap-2">
      <label className="flex min-h-11 items-center gap-3 text-[15px] font-semibold">
        <input type="checkbox" checked={item.done} disabled={isLoading} onChange={(e) => commit(e.target.checked)} className="h-5 w-5 flex-none accent-ink" />
        <span className="min-w-0 flex-1">{item.label}</span><Chip done={item.done} />
      </label>
      <input aria-label={`Note for ${item.label}`} value={note} maxLength={300} placeholder="Add a note" onChange={(e) => setNote(e.target.value)}
        onBlur={() => { if (note.trim() !== (item.note ?? '')) commit(item.done) }} className={aField} />
      {err && <Notice tone="error">Could not save. Try again.</Notice>}
    </div>
  )
}

function Milestones({ d }: { d: Launch }) {
  const [save, { isLoading }] = useSaveLaunchMutation()
  const [date, setDate] = useState(d.betaStartedAt ? d.betaStartedAt.slice(0, 10) : '')
  const [confirm, setConfirm] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => setDate(d.betaStartedAt ? d.betaStartedAt.slice(0, 10) : ''), [d.betaStartedAt])
  const idx = STAGES.findIndex((s) => s.key === d.stage)
  async function run(body: { betaStartedAt: string | null; paidTest?: boolean }, ok: string) {
    setMsg(null)
    try { await save(body).unwrap(); setMsg({ ok: true, text: ok }); setConfirm(false) } catch { setMsg({ ok: false, text: 'Could not save. Try again.' }) }
  }
  const startIso = () => (date ? new Date(`${date}T00:00:00`).toISOString() : null)
  return (
    <section aria-labelledby="ms-title" className={`${aCard} flex flex-col gap-5`}>
      <h2 id="ms-title" className={h2}>Milestones</h2>
      <ol aria-label="Launch stage" className="grid grid-cols-4 gap-1.5">
        {STAGES.map((s, i) => (
          <li key={s.key} aria-current={i === idx ? 'step' : undefined} className="flex flex-col gap-1.5">
            <span className={`h-2 rounded-full ${i < idx ? 'bg-verified' : i === idx ? 'bg-ember' : 'bg-mist'}`} />
            <span className={`text-xs sm:text-[13px] ${i === idx ? 'font-semibold' : 'text-slate'}`}>{s.label}</span>
          </li>
        ))}
      </ol>
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <Stat label="Beta day" value={d.day ?? '—'} sub={d.betaStartedAt ? `Started ${fmtDate(d.betaStartedAt)}` : 'Not started'} />
        <Stat label="Earliest paid test" value={fmtDate(d.paidTestEarliest)} />
        <Stat label="Checklist" value={`${d.doneCount} / ${d.total}`} sub="items done" />
      </ul>
      {d.next && (
        <div className="rounded-xl border border-ember bg-ember/10 p-3.5"><p className="text-xs font-semibold uppercase tracking-[0.06em] text-ember-deep">Next step</p><p className="text-[15px] font-semibold">{d.next.label}</p></div>
      )}
      <div className="flex flex-col gap-5">
        {GROUPS.map((g) => {
          const items = d.items.filter((i) => i.group === g.key)
          if (!items.length) return null
          return (
            <div key={g.key} className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-slate">{g.label}</h3>
              <ul className="flex flex-col divide-y divide-stone-200">
                {items.map((i) => (
                  <li key={i.key} className="py-3">
                    {i.kind === 'manual' ? <ManualItem item={i} /> : (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-start justify-between gap-3"><span className="text-[15px] font-semibold">{i.label}</span><Chip done={i.done} /></div>
                        <p className="text-[13px] text-slate">{i.detail}</p>
                      </div>
                    )}
                    {i.kind === 'manual' && i.detail && <p className="mt-1 text-[13px] text-slate">{i.detail}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
      <div className="flex flex-col gap-3 border-t border-stone-200 pt-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-semibold">Beta start date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${aField} font-normal`} /></label>
          <button type="button" disabled={isLoading} onClick={() => run({ betaStartedAt: startIso() }, 'Start date saved.')} className={aDark}>Save date</button>
        </div>
        {d.stage === 'paid_test' ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold">Paid test is on.</p>
            <button type="button" disabled={isLoading} onClick={() => run({ betaStartedAt: d.betaStartedAt, paidTest: false }, 'Paid test is off.')} className={aOutline}>Turn off</button>
          </div>
        ) : confirm ? (
          <div role="alertdialog" aria-label="Confirm paid test" className="flex flex-col gap-3 rounded-xl bg-paper p-3.5">
            <p className="text-sm">Start the paid test? This is only meant once every item above is done.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={isLoading} onClick={() => run({ betaStartedAt: d.betaStartedAt, paidTest: true }, 'Paid test started.')} className={aPrimary}>Yes, start paid test</button>
              <button type="button" onClick={() => setConfirm(false)} className={aOutline}>Cancel</button>
            </div>
          </div>
        ) : <button type="button" onClick={() => setConfirm(true)} className={`${aOutline} w-fit`}>Start paid test</button>}
        {msg && <Notice tone={msg.ok ? 'info' : 'error'}>{msg.text}</Notice>}
      </div>
    </section>
  )
}

function ActiveCard({ label, g }: { label: string; g: { women: number; men: number; total: number } }) {
  return <li className="flex flex-col gap-0.5 rounded-xl bg-paper p-3"><span className="text-[13px] text-slate">{label}</span><span className="font-display text-2xl font-semibold">{g.total}</span><span className="text-xs text-slate">{g.women} women · {g.men} men</span></li>
}

function SignupsChart({ rows }: { rows: UsersOverview['signupsPerDay'] }) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  const total = rows.reduce((a, r) => a + r.count, 0)
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-semibold">Sign-ups per day, last 30 days <span className="font-normal text-slate">({total} total)</span></figcaption>
      <div role="img" aria-label={`Sign-ups per day, ${total} in total`} className="flex h-28 items-end gap-[2px]">
        {rows.map((r) => (
          <div key={r.day} title={`${r.day}: ${r.count}`} className="flex h-full flex-1 items-end"><div className="w-full rounded-t-sm bg-ember" style={{ height: `${Math.max(r.count ? 4 : 1, (r.count / max) * 100)}%`, opacity: r.count ? 1 : 0.25 }} /></div>
        ))}
      </div>
      {rows.length > 0 && <div className="flex justify-between text-xs text-slate"><span>{rows[0]!.day}</span><span>{rows[rows.length - 1]!.day}</span></div>}
    </figure>
  )
}

function People({ u }: { u: UsersOverview }) {
  const status = Object.entries(u.byStatus)
  const top = Math.max(1, ...u.funnel.map((f) => f.count))
  return (
    <section aria-labelledby="ppl-title" className={`${aCard} flex flex-col gap-5`}>
      <h2 id="ppl-title" className={h2}>Who is on the platform</h2>
      <div className="flex flex-col gap-2"><h3 className="text-sm font-semibold text-slate">Active now</h3>
        <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-3"><ActiveCard label="Last 24 hours" g={u.active.d1} /><ActiveCard label="Last 7 days" g={u.active.d7} /><ActiveCard label="Last 30 days" g={u.active.d30} /></ul></div>
      <div className="flex flex-col gap-2"><h3 className="text-sm font-semibold text-slate">Members by status</h3>
        {status.length === 0 ? <p className="text-sm text-slate">No members yet.</p> : <Grid>{status.map(([k, v]) => <Stat key={k} label={k.replace(/_/g, ' ')} value={v} />)}</Grid>}</div>
      <SignupsChart rows={u.signupsPerDay} />
      <div className="flex flex-col gap-3"><h3 className="text-sm font-semibold text-slate">Sign-up funnel</h3>
        {u.funnel.map((f, i) => {
          const prev = i > 0 ? u.funnel[i - 1]!.count : 0
          const drop = i > 0 && prev > 0 ? Math.round((1 - f.count / prev) * 100) : null
          return (
            <div key={f.key} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2 text-sm"><span className="font-semibold">{f.step}</span><span>{f.count}{drop !== null && <span className="text-slate"> · {drop}% drop-off</span>}</span></div>
              <div role="progressbar" aria-label={f.step} aria-valuemin={0} aria-valuemax={top} aria-valuenow={f.count} className="h-2.5 overflow-hidden rounded-full bg-mist"><div className="h-full rounded-full bg-ink" style={{ width: `${(f.count / top) * 100}%` }} /></div>
            </div>
          )
        })}</div>
    </section>
  )
}

function Arrive({ u }: { u: UsersOverview }) {
  const s = u.sources
  return (
    <section aria-labelledby="arr-title" className={`${aCard} flex flex-col gap-5`}>
      <h2 id="arr-title" className={h2}>How people arrive</h2>
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-4"><Stat label="Campaign links" value={s.byKind.campaign} /><Stat label="Member invites" value={s.byKind.member} /><Stat label="Invite batches" value={s.byKind.batch} /><Stat label="Direct" value={s.byKind.direct} /></ul>
      <div className="flex flex-col gap-2"><h3 className="text-sm font-semibold text-slate">Invite batches</h3>
        {s.batches.length === 0 ? <p className="text-sm text-slate">No batches used yet.</p> : (
          <div className="overflow-x-auto rounded-xl border border-stone-200"><table className="w-full min-w-[20rem]"><thead><tr><th className={th}>Label</th><th className={th}>Uses</th><th className={th}>Verified</th></tr></thead>
            <tbody className="divide-y divide-stone-200">{s.batches.map((b) => <tr key={b.label}><td className={td}>{b.label}</td><td className={td}>{b.uses}</td><td className={td}>{b.verified}</td></tr>)}</tbody></table></div>)}</div>
      <div className="flex flex-col gap-2"><h3 className="text-sm font-semibold text-slate">Top inviters</h3>
        {s.topInviters.length === 0 ? <p className="text-sm text-slate">No member invites yet.</p> : (
          <div className="overflow-x-auto rounded-xl border border-stone-200"><table className="w-full min-w-[20rem]"><thead><tr><th className={th}>Member</th><th className={th}>Friends</th><th className={th}>Verified</th></tr></thead>
            <tbody className="divide-y divide-stone-200">{s.topInviters.map((b) => <tr key={b.memberId}><td className={`${td} font-mono`}>{b.memberId}</td><td className={td}>{b.friends}</td><td className={td}>{b.verified}</td></tr>)}</tbody></table></div>)}</div>
    </section>
  )
}

function CapBar({ label, value, cap, text }: { label: string; value: number; cap: number; text: string }) {
  const w = Math.max(0, Math.min(100, Math.round((value / cap) * 100)))
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-sm"><span className="font-semibold">{label}</span><span className="text-slate">{text}</span></div>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={cap} aria-valuenow={Math.min(value, cap)} className="h-2.5 overflow-hidden rounded-full bg-mist">
        <div className={`h-full rounded-full ${w >= 100 ? 'bg-ember-deep' : 'bg-verified'}`} style={{ width: `${w}%` }} />
      </div>
    </div>
  )
}

function HealthCards({ h }: { h: Health }) {
  const m = h.marketplace, s = h.safety, $ = h.money
  return (
    <section aria-labelledby="hl-title" className={`${aCard} flex flex-col gap-5`}>
      <h2 id="hl-title" className={h2}>Health</h2>
      <div className="flex flex-col gap-2"><h3 className="text-sm font-semibold text-slate">Marketplace</h3>
        <Grid>
          <Stat label="Requests sent" value={m.requests.sent} sub={`${m.requests.accepted} accepted · ${m.requests.declined} declined · ${m.requests.pending} pending`} />
          <Stat label="Acceptance rate" value={pct(m.requests.acceptanceRate)} />
          <Stat label="Median reply time" value={hrs(m.medianReplyHours)} />
          <Stat label="Women with unanswered requests" value={m.womenWithUnanswered} />
          <Stat label="Men with no accepted request" value={m.menZeroAccepted} />
          <Stat label="Chats started" value={m.chatsStarted} sub={`${m.messagesPerChat.toFixed(1)} messages per chat`} />
          <Stat label="Voice messages" value={m.voiceMessages} />
        </Grid></div>
      <div className="flex flex-col gap-2"><h3 className="text-sm font-semibold text-slate">Back after a week</h3>
        <ul className="grid grid-cols-2 gap-2.5"><Stat label="Week one" value={`${m.retention.week1.women + m.retention.week1.men}`} sub={`${m.retention.week1.women} women · ${m.retention.week1.men} men`} /><Stat label="Week two" value={`${m.retention.week2.women + m.retention.week2.men}`} sub={`${m.retention.week2.women} women · ${m.retention.week2.men} men`} /></ul></div>
      <div className="flex flex-col gap-2"><h3 className="text-sm font-semibold text-slate">Safety</h3>
        <Grid><Stat label="Open reports" value={s.openReports} /><Stat label="Repeat reported" value={s.repeatReported} /><Stat label="Median report response" value={hrs(s.medianReportResponseHours)} /><Stat label="Suspended" value={s.suspended} /><Stat label="Blocks" value={s.blocks} /><Stat label="Deletion requests" value={s.deletionRequests} /></Grid></div>
      <div className="flex flex-col gap-2"><h3 className="text-sm font-semibold text-slate">Money</h3>
        <Grid><Stat label="Payments pending" value={$.pending} /><Stat label="Approved" value={$.approved} /><Stat label="Rejected" value={$.rejected} /><Stat label="Revenue, after refunds" value={inr($.revenuePaise)} sub={$.capPaise == null ? 'Sales limit: No limit' : `Sales limit: ${inr($.capPaise)}`} /><Stat label="Refunded" value={inr($.refundedPaise ?? 0)} /><Stat label="Paying men" value={$.paidMen} sub={$.capMen == null ? 'Limit: No limit' : `Limit: ${$.capMen}`} /></Grid>
        {$.capPaise != null && $.capPaise > 0 && <CapBar label="Sales against the limit" value={$.revenuePaise} cap={$.capPaise} text={`${inr($.revenuePaise)} of ${inr($.capPaise)}`} />}
        {$.capMen != null && $.capMen > 0 && <CapBar label="Paying men against the limit" value={$.paidMen} cap={$.capMen} text={`${$.paidMen} of ${$.capMen}`} />}</div>
    </section>
  )
}

function Alerts({ h }: { h: Health }) {
  if (!h.alerts.length) return null
  return (
    <section aria-label="Alerts" className="mb-5 flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {h.alerts.map((a) => (
          <li key={a.key} className={`rounded-xl p-3.5 text-[15px] font-semibold ${a.level === 'warn' ? 'bg-ember text-ink' : 'bg-mist text-ink'}`}><span className="sr-only">{a.level === 'warn' ? 'Needs attention: ' : 'Note: '}</span>{a.text}</li>
        ))}
      </ul>
    </section>
  )
}

export default function LaunchPage() {
  const l = useAdminLaunchQuery(undefined, { pollingInterval: 60000 })
  const u = useUsersOverviewQuery(undefined, { pollingInterval: 60000 })
  const h = useAdminHealthQuery(undefined, { pollingInterval: 60000 })
  return (
    <>
      <PageTitle title="Launch" sub="Milestones, who is on the platform, how they arrive, and how it is going." />
      {h.data && <Alerts h={h.data} />}
      <div className="flex flex-col gap-6">
        {l.isLoading ? <Loading /> : l.isError || !l.data ? <ErrorState what="milestones" onRetry={l.refetch} /> : <Milestones d={l.data} />}
        {u.isLoading ? <Loading /> : u.isError || !u.data ? <ErrorState what="the people overview" onRetry={u.refetch} /> : <><People u={u.data} /><Arrive u={u.data} /></>}
        {h.isLoading ? <Loading /> : h.isError || !h.data ? <ErrorState what="health" onRetry={h.refetch} /> : <HealthCards h={h.data} />}
      </div>
    </>
  )
}
