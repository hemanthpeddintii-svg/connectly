import { Link } from 'react-router-dom'
import { useSkippedQuery, useUnskipMutation } from '../api'
import Monogram from '../components/Monogram'
import RealPerson from '../components/Badge'
import { EmptyState, ErrorState, Loading } from '../components/State'
import { Stagger, StaggerItem } from '../components/motion'
import { btnAccent, btnSecondary, chip } from '../ui'

/** People the member said "Not now" to. A skip is never final: send a request, or bring them back to the community list. */
export default function SkippedList() {
  const { data, isLoading, isError, refetch } = useSkippedQuery()
  const [unskip, { isLoading: busy, isError: failed }] = useUnskipMutation()
  if (isLoading) return <Loading />
  if (isError) return <ErrorState what="your skipped members" onRetry={refetch} />
  if (!data?.length) {
    return (
      <EmptyState title="No one on hold">
        <p>Anyone you say "Not now" to waits here. Change your mind whenever.</p>
      </EmptyState>
    )
  }
  return (
    <section aria-label="Skipped members" className="flex flex-col gap-3">
      <p className="text-[13px] text-slate">People you said "Not now" to. They don't know. You can still reach out, or bring them back.</p>
      {failed && <p role="alert" className="text-sm text-ember-deep">That didn't go through. Try again?</p>}
      <Stagger as="ul" className="flex flex-col gap-3">
        {data.map((p) => (
          <StaggerItem as="li" key={p.memberId} className="flex flex-col gap-3 rounded-[22px] border border-stone-200 bg-white p-5">
            <div className="flex items-center gap-3.5">
              <Monogram name={p.name} size={56} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <h2 className="font-display text-[22px] leading-tight">{p.name}, {p.age}</h2>
                <RealPerson variant="pill" />
              </div>
            </div>
            {p.bio && <p className="line-clamp-3 whitespace-pre-wrap break-words text-[15px] leading-normal">{p.bio}</p>}
            {p.interests.length > 0 && (
              <ul className="flex flex-wrap gap-2">{p.interests.slice(0, 5).map((i) => <li key={i} className={chip}>{i}</li>)}</ul>
            )}
            <div className="flex gap-3">
              <button type="button" disabled={busy} onClick={() => unskip({ memberId: p.memberId })} className={`${btnSecondary} !h-12 flex-1`}>Bring back</button>
              <Link to={`/request/${p.memberId}`} className={`${btnAccent} !h-12 flex-[1.3]`}>Send request</Link>
            </div>
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  )
}
