import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useMeQuery, useSkipMutation, useSkippedQuery, useWallQuery, type Profile } from '../api'
import SkippedList from './SkippedList'
import SafetyMenu from '../features/safety/SafetyMenu'
import FilterSheet, { activeFilters } from '../features/preferences/FilterSheet'
import { usePreferencesQuery, useSavePreferencesMutation } from '../features/preferences/api'
import { plural } from '../format'
import { btnAccent, btnSecondary, chip, eyebrow } from '../ui'
import { PageFade, Stagger, StaggerItem } from '../components/motion'
import PriceQuestion from '../components/PriceQuestion'
import Monogram from '../components/Monogram'
import RealPerson from '../components/Badge'
import CreditsChip from '../components/CreditsChip'
import { CloseIcon, Wordmark } from '../components/icons'
import { EmptyState, ErrorState, Loading } from '../components/State'

function MemberCard({ p, onSkip, busy }: { p: Profile; onSkip: () => void; busy: boolean }) {
  return (
    <article aria-label={`${p.name}, ${p.age}`} className="flex flex-col gap-4 rounded-[24px] border border-stone-200 bg-white p-5">
      <div className="flex items-start gap-3.5">
        <Monogram name={p.name} size={64} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
          <h2 className="font-display text-[26px] leading-tight">{p.name}, {p.age}</h2>
          <p className="text-[13px] text-slate">{p.city || 'City not shared'}</p>
          <RealPerson variant="pill" />
        </div>
        <SafetyMenu memberId={p.memberId} />
      </div>
      {p.bio && <p className="line-clamp-4 whitespace-pre-wrap break-words text-[15px] leading-normal">{p.bio}</p>}
      {(p.languages.length > 0 || p.interests.length > 0) && (
        <ul aria-label="Languages and interests" className="flex flex-wrap gap-2">
          {p.languages.map((l) => <li key={`l-${l}`} className={`${chip} !bg-sage`}>{l}</li>)}
          {p.interests.map((i) => <li key={`i-${i}`} className={chip}>{i}</li>)}
        </ul>
      )}
      <div className="flex gap-3">
        <button type="button" disabled={busy} onClick={onSkip} className={`${btnSecondary} !h-12 flex-1`}>Not now</button>
        <Link to={`/request/${p.memberId}`} className={`${btnAccent} !h-12 flex-[1.4]`}>Send request</Link>
      </div>
    </article>
  )
}

/** The community for men: everyone who matches the filters, so you can choose who to write to. Women are sent to their requests. */
export default function Wall() {
  const { data: me } = useMeQuery()
  const man = me?.gender === 'man'
  const { data, isLoading, isError, refetch } = useWallQuery(undefined, { skip: !man })
  const [skip, { isLoading: skipping, isError: skipFailed }] = useSkipMutation()
  const [view, setView] = useState<'new' | 'skipped'>('new')
  const [filtering, setFiltering] = useState(false)
  const { data: skippedList } = useSkippedQuery(undefined, { skip: !man })
  const { data: prefs } = usePreferencesQuery(undefined, { skip: !man })
  const [savePrefs] = useSavePreferencesMutation()
  if (me?.gender === 'woman') return <Navigate to="/requests" replace />
  if (!me || isLoading) return <Loading />

  const credits = me.requestCredits
  const active = prefs ? activeFilters(prefs) : []
  const removeFilter = (key: string) => {
    if (!prefs) return
    const next = { ...prefs }
    if (key === 'age') { next.minAge = null; next.maxAge = null }
    if (key === 'city') next.city = ''
    if (key === 'languages') next.languages = []
    if (key === 'interests') next.interests = []
    void savePrefs(next)
  }
  return (
    <PageFade className="flex flex-1 flex-col gap-4">
      <div className="flex h-12 items-center justify-between md:hidden">
        <Wordmark />
        <CreditsChip credits={credits} />
      </div>
      <h1 className="sr-only">Community</h1>
      <PriceQuestion />
      <div className="flex items-center justify-between gap-3">
        <div role="group" aria-label="Community view" className="flex gap-1 rounded-full bg-mist p-1">
          {([['new', 'Community'], ['skipped', `Skipped${skippedList?.length ? ` (${skippedList.length})` : ''}`]] as const).map(([v, label]) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
              className={`h-10 rounded-full px-4 text-sm transition duration-200 ${view === v ? 'bg-white font-semibold shadow-soft' : 'font-medium text-slate hover:text-ink'}`}>{label}</button>
          ))}
        </div>
        {view === 'new' && (
          <button type="button" onClick={() => setFiltering(true)} aria-haspopup="dialog"
            className="inline-flex h-11 items-center gap-2 rounded-full border border-stone-300 bg-white px-4 text-sm font-medium transition hover:border-ink">
            <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>
            Filters{active.length > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1 text-xs font-semibold text-paper">{active.length}</span>}
          </button>
        )}
      </div>
      {view === 'new' && active.length > 0 && (
        <ul aria-label="Active filters" className="flex flex-wrap gap-2">
          {active.map((f) => (
            <li key={f.key} className="inline-flex h-9 max-w-full items-center gap-1 rounded-full bg-sage pl-3.5 pr-1 text-[13px] font-medium text-verified">
              <span className="truncate">{f.label}</span>
              <button type="button" onClick={() => removeFilter(f.key)} aria-label={`Remove filter: ${f.label}`}
                className="flex h-7 w-7 flex-none items-center justify-center rounded-full transition hover:bg-white/70"><CloseIcon size={13} /></button>
            </li>
          ))}
        </ul>
      )}
      {view === 'skipped' ? <SkippedList /> : isError ? <ErrorState what="the community" onRetry={refetch} />
        : !data?.length ? (
          <EmptyState title={active.length ? 'No one matches these filters' : "That's everyone for now"}
            actions={active.length ? <button type="button" onClick={() => setFiltering(true)} className={btnSecondary}>Change filters</button> : undefined}>
            {active.length
              ? <p>Try a wider age range, or remove a filter. Nothing is lost while you wait.</p>
              : <><p>You've seen everyone who fits right now. New members arrive as they're checked, so come back soon.</p><p>People you said "Not now" to are in the Skipped tab.</p></>}
          </EmptyState>
        ) : (
          <>
            <p className={eyebrow}>{data.length >= 50 ? '50+ people' : plural(data.length, 'person', 'people')} to meet</p>
            {skipFailed && <p role="alert" className="text-sm text-ember-deep">That didn't go through. Try again?</p>}
            <Stagger as="ul" className="flex flex-col gap-4">
              {data.map((p) => (
                <StaggerItem as="li" key={p.memberId}><MemberCard p={p} busy={skipping} onSkip={() => skip({ memberId: p.memberId })} /></StaggerItem>
              ))}
            </Stagger>
            <p className="text-center text-[13px] text-slate">
              {credits > 0 ? `Each request uses 1 of your ${plural(credits, 'request')}. Choose who you'd like to write to.` : "You're out of requests. You can get more next."}
            </p>
          </>
        )}
      {filtering && <FilterSheet onClose={() => setFiltering(false)} />}
    </PageFade>
  )
}
