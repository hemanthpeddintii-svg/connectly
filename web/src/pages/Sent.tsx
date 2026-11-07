import { Link, Navigate } from 'react-router-dom'
import { useMeQuery, useSentRequestsQuery, type RequestStatus } from '../api'
import { sentAgo } from '../format'
import Monogram from '../components/Monogram'
import PageHeader from '../components/PageHeader'
import { EmptyState, ErrorState, Loading } from '../components/State'
import { CheckIcon, ClockIcon, CloseIcon } from '../components/icons'
import { btnPrimary } from '../ui'

// Status is always an icon plus a word, never colour alone.
const STATUS: Record<RequestStatus, { word: string; icon: typeof ClockIcon; cls: string }> = {
  pending: { word: 'Waiting', icon: ClockIcon, cls: 'bg-mist text-ink' },
  accepted: { word: 'Accepted', icon: CheckIcon, cls: 'bg-mist text-verified' },
  declined: { word: 'Not now', icon: CloseIcon, cls: 'bg-stone-200 text-slate' },
}

/** Requests a man has sent, newest first. */
export default function Sent() {
  const { data: me } = useMeQuery()
  const man = me?.gender === 'man'
  const { data, isLoading, isError, refetch } = useSentRequestsQuery(undefined, { skip: !man })
  if (me?.gender === 'woman') return <Navigate to="/requests" replace />
  if (!me || isLoading) return <Loading />
  const rows = data ? [...data].sort((a, b) => b.createdAt - a.createdAt) : []
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Requests you've sent" back="/connections" backLabel="Back to chats" />
      {isError ? <ErrorState what="your requests" onRetry={refetch} />
        : !rows.length ? (
          <EmptyState title="No requests sent yet" actions={<Link to="/wall" className={btnPrimary}>Go to community</Link>}>
            <p>When you send a request, you can follow its answer here.</p>
          </EmptyState>
        ) : (
          <>
            <p className="text-[15px] text-slate">Newest first. A member can take her time to answer.</p>
            <ul className="flex flex-col gap-2.5">
              {rows.map((r) => {
                const s = STATUS[r.status]
                const Icon = s.icon
                return (
                  <li key={r.id} className="flex min-h-[76px] items-center gap-3.5 rounded-[22px] bg-white p-3.5">
                    <Monogram name={r.to.name} size={44} />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <b className="truncate font-display text-base font-semibold">{r.to.name}, {r.to.age}</b>
                      {r.status === 'accepted' && r.connectionId
                        ? <Link to={`/connections/${r.connectionId}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-ember-deep underline">Open chat</Link>
                        : <span className="text-[13px] text-slate">{sentAgo(r.createdAt)}</span>}
                    </div>
                    <span className={`inline-flex h-8 flex-none items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold ${s.cls}`}>
                      <Icon size={14} />{s.word}
                    </span>
                  </li>
                )
              })}
            </ul>
            <p className="text-[13px] leading-snug text-slate">Not now is a kind, private answer. Each request uses 1 credit, whatever the reply.</p>
          </>
        )}
    </div>
  )
}
