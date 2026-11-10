import { Link, Navigate } from 'react-router-dom'
import { useMeQuery, useSkipMutation, useWallQuery } from '../api'
import SafetyMenu from '../features/safety/SafetyMenu'
import { plural } from '../format'
import { btnPrimary, btnSecondary, card, chip, eyebrow } from '../ui'
import PriceQuestion from '../components/PriceQuestion'
import Monogram from '../components/Monogram'
import RealPerson from '../components/Badge'
import CreditsChip from '../components/CreditsChip'
import { Wordmark } from '../components/icons'
import { EmptyState, ErrorState, Loading } from '../components/State'

/** The community for men: one member at a time. Women are sent to their requests. */
export default function Wall() {
  const { data: me } = useMeQuery()
  const man = me?.gender === 'man'
  const { data, isLoading, isError, refetch } = useWallQuery(undefined, { skip: !man })
  const [skip, { isLoading: skipping, isError: skipFailed }] = useSkipMutation()
  if (me?.gender === 'woman') return <Navigate to="/requests" replace />
  if (!me || isLoading) return <Loading />

  const credits = me.requestCredits
  const p = data?.[0]
  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex h-12 items-center justify-between md:hidden">
        <Wordmark />
        <CreditsChip credits={credits} />
      </div>
      <h1 className="sr-only">Community</h1>
      <PriceQuestion />
      {isError ? <ErrorState what="the community" onRetry={refetch} />
        : !p ? (
          <EmptyState title="You're all caught up">
            <p>You've met everyone who fits right now. New members join as they're checked, so it's worth a look again soon.</p>
            <p>Nothing is lost while you wait.</p>
          </EmptyState>
        ) : (
          <>
            <article aria-label={`${p.name}, ${p.age}`} className={`${card} flex flex-col gap-4 rounded-[28px]`}>
              <div className="flex items-start gap-4">
                <Monogram name={p.name} size={92} />
                <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
                  <h2 className="font-display text-[26px] font-semibold leading-tight">{p.name}, {p.age}</h2>
                  <RealPerson variant="pill" />
                </div>
                <SafetyMenu memberId={p.memberId} />
              </div>
              {p.bio && (
                <section className="flex flex-col gap-1">
                  <h3 className={eyebrow}>About me</h3>
                  <p className="whitespace-pre-wrap break-words text-[15px] leading-normal">{p.bio}</p>
                </section>
              )}
              {p.languages.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h3 className={eyebrow}>Languages</h3>
                  <ul className="flex flex-wrap gap-2">{p.languages.map((i) => <li key={i} className={chip}>{i}</li>)}</ul>
                </section>
              )}
              {p.interests.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h3 className={eyebrow}>Interests</h3>
                  <ul className="flex flex-wrap gap-2">{p.interests.map((i) => <li key={i} className={chip}>{i}</li>)}</ul>
                </section>
              )}
              <p className="text-[13px] leading-snug text-slate">No photos here. Members get to know each other by what they share.</p>
            </article>
            {skipFailed && <p role="alert" className="text-sm text-ember-deep">Couldn't do that. Please try again.</p>}
            <div className="flex gap-3">
              <button type="button" disabled={skipping} onClick={() => skip({ memberId: p.memberId })} className={`${btnSecondary} h-[52px] flex-1`}>Not now</button>
              <Link to={`/request/${p.memberId}`} className={`${btnPrimary} h-[52px] flex-[1.4] text-base`}>Send request</Link>
            </div>
            <p className="text-center text-[13px] text-slate">
              {credits > 0 ? `Uses 1 of your ${plural(credits, 'request')}` : "You're out of requests. You can get more next."}
            </p>
          </>
        )}
    </div>
  )
}
