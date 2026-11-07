import { Link } from 'react-router-dom'
import { useConnectionsQuery, useMeQuery } from '../api'
import SafetyMenu from '../features/safety/SafetyMenu'
import { btnPrimary, btnOutline } from '../ui'
import Monogram from '../components/Monogram'
import { EmptyState, ErrorState, Loading } from '../components/State'
import { ChevronIcon } from '../components/icons'

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
            <ul className="flex flex-col overflow-hidden rounded-[22px] bg-white">
              {data.map((c) => (
                <li key={c.id} className="flex items-center border-b border-stone-200 last:border-b-0">
                  <Link to={`/connections/${c.id}`} aria-label={`Chat with ${c.profile.name}, ${c.profile.age}`}
                    className="flex min-h-[76px] flex-1 items-center gap-3.5 px-4 py-3">
                    <Monogram name={c.profile.name} size={44} />
                    <span className="flex flex-col">
                      <b className="font-display text-base font-semibold">{c.profile.name}</b>
                      <span className="text-[13px] text-slate">{c.profile.age}</span>
                    </span>
                  </Link>
                  <div className="px-3"><SafetyMenu bumpId={c.profile.bumpId} /></div>
                </li>
              ))}
            </ul>
            {sentLink}
          </>
        )}
    </div>
  )
}
