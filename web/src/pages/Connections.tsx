import { Link } from 'react-router-dom'
import { useConnectionsQuery, useMeQuery } from '../api'
import SafetyMenu from '../features/safety/SafetyMenu'
import { btnPrimary, btnOutline } from '../ui'
import Monogram from '../components/Monogram'
import { EmptyState, ErrorState, Loading } from '../components/State'
import { ChevronIcon } from '../components/icons'

function ago(ms: number, now = Date.now()) {
  const m = Math.floor((now - ms) / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  return new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export default function Connections() {
  const { data: me } = useMeQuery()
  const { data, isLoading, isError, refetch } = useConnectionsQuery()
  const man = me?.gender === 'man'
  const sentLink = man && (
    <Link to="/sent" className="flex min-h-14 items-center justify-between rounded-[22px] bg-white px-5 text-[15px] font-semibold">
      Requests you've sent <ChevronIcon size={20} />
    </Link>
  )
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 pt-2">
        <h1 className="font-display text-[28px] font-semibold leading-tight">Chats</h1>
        <p className="text-[15px] leading-snug text-slate">Free to use. Text and voice, with members who said yes.</p>
      </div>
      {isLoading ? <Loading />
        : isError ? <ErrorState what="your chats" onRetry={refetch} />
        : !data?.length ? (
          <EmptyState title="Your first chat starts when a request is accepted"
            actions={man ? (
              <>
                <Link to="/wall" className={btnPrimary}>Go to community</Link>
                <Link to="/sent" className={btnOutline}>See requests you've sent</Link>
              </>
            ) : <Link to="/requests" className={btnPrimary}>Go to requests</Link>}>
            <p>When a member says yes, the door opens and your chat shows up here.</p>
          </EmptyState>
        ) : (
          <>
            {/* No overflow-hidden here: it would clip the Block/Report menu. The end rows round themselves instead. */}
            <ul className="flex flex-col rounded-[22px] bg-white">
              {data.map((c) => (
                <li key={c.id} className="flex items-center border-b border-stone-200 first:rounded-t-[22px] last:rounded-b-[22px] last:border-b-0">
                  <Link to={`/connections/${c.id}`}
                    aria-label={`Chat with ${c.profile.name}, ${c.profile.age}${c.unread ? `, ${c.unread} unread` : ''}`}
                    className="flex min-h-[76px] min-w-0 flex-1 items-center gap-3.5 px-4 py-3">
                    <Monogram name={c.profile.name} size={44} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-baseline justify-between gap-2">
                        <b className="truncate font-display text-base font-semibold">{c.profile.name}</b>
                        {c.lastMessage && <span className="flex-none text-xs text-slate">{ago(c.lastMessage.createdAt)}</span>}
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className={`truncate text-[13px] ${c.unread ? 'font-semibold text-ink' : 'text-slate'}`}>
                          {c.lastMessage ? `${c.lastMessage.mine ? 'You: ' : ''}${c.lastMessage.preview}` : 'Say hello'}
                        </span>
                        {c.unread > 0 && (
                          <span className="flex h-6 min-w-6 flex-none items-center justify-center rounded-full bg-ember px-1.5 text-xs font-bold text-ink">{c.unread > 99 ? '99+' : c.unread}</span>
                        )}
                      </span>
                    </span>
                  </Link>
                  <div className="px-3"><SafetyMenu memberId={c.profile.memberId} /></div>
                </li>
              ))}
            </ul>
            {sentLink}
          </>
        )}
    </div>
  )
}
