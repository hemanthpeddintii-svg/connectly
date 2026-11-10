import { Link } from 'react-router-dom'
import { ago, useAdminOverviewQuery } from '../../features/admin/api'
import { ErrorState, Loading } from '../../components/State'
import { PageTitle, aCard, aPrimary, th, td } from '../../components/admin/ui'

const kindLabel = { verification: 'Verification', payment: 'Payment', report: 'Report' } as const

export default function Overview() {
  const { data, isLoading, isError, refetch } = useAdminOverviewQuery()
  if (isLoading) return <><PageTitle title="Overview" /><Loading /></>
  if (isError || !data) return <><PageTitle title="Overview" /><ErrorState what="the overview" onRetry={refetch} /></>
  const cards = [
    { key: 'verification' as const, title: 'Verifications', n: data.verificationsPending, to: '/admin/verifications', word: 'waiting' },
    { key: 'payment' as const, title: 'Payments', n: data.paymentsPending, to: '/admin/payments', word: 'waiting' },
    { key: 'report' as const, title: 'Reports', n: data.reportsOpen, to: '/admin/reports', word: 'open' },
  ]
  return (
    <>
      <PageTitle title="Overview" sub="What needs a decision right now." />
      <ul className="mb-8 grid gap-4 md:grid-cols-3">
        {cards.map((c) => (
          <li key={c.key} className={`${aCard} flex flex-col gap-3`}>
            <h2 className="text-sm font-semibold text-slate">{c.title}</h2>
            <p className="font-display text-4xl font-semibold">{c.n} <span className="text-base font-medium text-slate">{c.word}</span></p>
            <p className="text-sm text-slate">{c.n ? `Oldest waiting ${ago(data.oldestWaiting[c.key])}` : 'All clear'}</p>
            {c.n > 0 ? <Link to={c.to} className={`${aPrimary} self-start`}>Review next</Link>
              : <Link to={c.to} className="inline-flex min-h-11 items-center text-sm font-semibold underline">Open queue</Link>}
          </li>
        ))}
      </ul>
      <section aria-labelledby="recent-h">
        <h2 id="recent-h" className="mb-3 font-display text-lg font-semibold">Recent decisions</h2>
        {!data.recent.length ? <p className="text-slate">No decisions yet.</p> : (
          <div className="overflow-x-auto rounded-2xl bg-white">
            <table className="w-full min-w-[480px]">
              <caption className="sr-only">Recent decisions</caption>
              <thead><tr className="border-b border-stone-200"><th scope="col" className={th}>Member</th><th scope="col" className={th}>Type</th><th scope="col" className={th}>Decision</th><th scope="col" className={th}>By</th><th scope="col" className={th}>When</th></tr></thead>
              <tbody>
                {data.recent.map((r, i) => (
                  <tr key={i} className="border-b border-stone-200 last:border-b-0">
                    <th scope="row" className={`${td} text-left font-semibold`}><Link className="underline" to={`/admin/members/${r.member.memberId}`}>{r.member.name}</Link></th>
                    <td className={td}>{kindLabel[r.kind]}</td><td className={`${td} capitalize`}>{r.decision}</td><td className={td}>{r.by}</td><td className={td}>{ago(r.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
