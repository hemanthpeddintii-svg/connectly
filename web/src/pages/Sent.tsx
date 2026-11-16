import { Link, Navigate } from 'react-router-dom'
import { useMeQuery, useSentRequestsQuery, type RequestStatus } from '../api'
import { sentAgo } from '../format'
import Monogram from '../components/Monogram'
import PageHeader from '../components/PageHeader'
import { EmptyState, ErrorState, Loading } from '../components/State'
import { CheckIcon, ClockIcon, CloseIcon } from '../components/icons'
import { btnPrimary, card } from '../ui'
import { PageFade, Stagger, StaggerItem } from '../components/motion'

// Status is always an icon plus a word, never colour alone.
const STATUS: Record<RequestStatus | 'expired', { word: string; icon: typeof ClockIcon; cls: string }> = {
  pending: { word: 'Waiting', icon: ClockIcon, cls: 'bg-mist text-ink' },
  accepted: { word: 'Accepted', icon: CheckIcon, cls: 'bg-sage text-verified' },
  declined: { word: 'Not now', icon: CloseIcon, cls: 'bg-stone-200 text-slate' },
  expired: { word: 'Returned', icon: ClockIcon, cls: 'bg-mist text-ink' },
}

/** Three calm steps: sent, with her, answered. It never shows when she opened it, so nobody feels watched. */
function Steps({ status }: { status: RequestStatus }) {
  const done = status === 'pending' ? 2 : 3
  const labels = ['Sent', 'With her', status === 'accepted' ? 'Come in' : status === 'declined' ? 'Not now' : 'Answer']
  return (
    <ol aria-label="Request progress" className="flex items-center gap-1.5 text-[12px] text-slate">
      {labels.map((l, i) => (
        <li key={l} aria-current={i === done - 1 ? 'step' : undefined} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${i < done ? (status === 'accepted' && i === 2 ? 'bg-ember' : 'bg-ink') : 'bg-stone-300'}`} />
          <span className={i < done ? 'font-medium text-ink' : ''}>{l}</span>
        </li>
      ))}
    </ol>
  )
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
    <PageFade className="flex flex-col gap-4">
      <PageHeader title="Requests you've sent" back="/connections" backLabel="Back to chats" />
      {isError ? <ErrorState what="your requests" onRetry={refetch} />
        : !rows.length ? (
          <EmptyState title="Nothing sent yet" actions={<Link to="/wall" className={btnPrimary}>Go to community</Link>}>
            <p>Send a note and follow where it goes right here.</p>
          </EmptyState>
        ) : (
          <>
            <p className="text-[15px] text-slate">Newest first. A member can take her time to answer.</p>
            <Stagger as="ul" className="flex flex-col gap-3">
              {rows.map((r) => {
                const s = STATUS[r.expiredAt ? 'expired' : r.status]
                const Icon = s.icon
                return (
                  <StaggerItem as="li" key={r.id} className={`${card} flex min-h-[76px] items-center gap-3.5 !p-4`}>
                    <Monogram name={r.to.name} size={44} />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <b className="truncate font-display text-lg">{r.to.name}, {r.to.age}</b>
                      {r.status === 'accepted' && r.connectionId
                        ? <Link to={`/connections/${r.connectionId}`} className="inline-flex min-h-11 items-center text-sm font-medium text-ink underline underline-offset-4">Open chat</Link>
                        : r.expiredAt ? <span className="text-[13px] text-slate">No answer in 14 days. Your request is back in your balance.</span>
                        : <><Steps status={r.status} /><span className="text-[12px] text-slate">{sentAgo(r.createdAt)}</span></>}
                    </div>
                    <span className={`inline-flex h-8 flex-none items-center gap-1.5 rounded-full px-3 text-[13px] font-medium ${s.cls}`}>
                      <Icon size={14} />{s.word}
                    </span>
                  </StaggerItem>
                )
              })}
            </Stagger>
            {rows.some((r) => r.status === 'declined') && (
              <p role="note" className="rounded-2xl bg-sage px-4 py-3 text-[14px] leading-snug text-slate">
                A not now is never about you. Next time, a note that mentions something specific from her profile usually feels more personal.
              </p>
            )}
            <p className="text-[13px] leading-snug text-slate">Not now is a kind, private answer, and it uses the request. If nobody answers in 14 days, it comes back to you.</p>
          </>
        )}
    </PageFade>
  )
}
