import { Link } from 'react-router-dom'
import { usePlansQuery } from '../api'
import { inr } from '../format'
import { btnOutline } from '../ui'
import { ChevronIcon, ArchIcon } from './icons'
import PageHeader from './PageHeader'

/** Shown instead of the request form when a man has no requests left. */
export default function OutOfRequests() {
  const { data } = usePlansQuery()
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Get requests" back="/wall" backLabel="Back to community" />
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-mist"><ArchIcon size={32} /></span>
        <h2 className="font-display text-2xl font-semibold">You have 0 requests</h2>
        <p className="max-w-sm text-[15px] leading-relaxed text-slate">
          Each request is a knock. A member reads your note and chooses whether to accept. When you'd like to knock again, pick a pack.
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {data?.plans.map((p) => (
          <li key={p.id}>
            <Link to={`/membership?pack=${p.id}`} aria-label={`${p.requests} requests for ${inr(p.amountPaise)}. Continue to payment`}
              className="flex min-h-[72px] items-center justify-between rounded-3xl bg-white px-5 py-3">
              <span className="flex flex-col"><b className="font-display text-lg">{p.requests} requests</b><span className="text-[13px] text-slate">They never expire</span></span>
              <span className="flex items-center gap-2 font-display text-lg font-semibold">{inr(p.amountPaise)}<ChevronIcon size={20} /></span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-1 text-[13px] leading-snug text-slate">
        <span>You pay by UPI and send us the reference. We check each payment by hand, so it may take a little while.</span>
        <span>Your chats stay free. A request that gets no answer or a not now isn't refunded.</span>
      </div>
      <Link to="/wall" className={`${btnOutline} self-stretch`}>Maybe later</Link>
    </div>
  )
}
