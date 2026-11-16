import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useDispatch } from 'react-redux'
import {
  api, authSlice, useConnectionsQuery, useMeQuery, useReceivedRequestsQuery, useSentRequestsQuery, useUpdateMeMutation,
} from '../api'
import { unsubscribeThisDevice } from '../features/push/unsubscribe'
import { plural } from '../format'
import { btnPrimary, btnSecondary, card, chip, eyebrow, field } from '../ui'
import { Loading } from '../components/State'
import InviteCard from '../components/InviteCard'
import BioPrompts from '../components/BioPrompts'
import ShareCards from '../components/ShareCards'
import TermsGate from '../features/onboarding/TermsGate'
import { CheckIcon, ChevronIcon } from '../components/icons'
import { PageFade } from '../components/motion'

const tile = 'flex min-h-[96px] flex-col justify-between rounded-[22px] border border-stone-200 bg-white p-4 transition hover:border-stone-300'
const action = 'flex min-h-14 items-center justify-between rounded-[22px] border border-stone-200 bg-white px-5 text-[15px] font-medium transition hover:border-stone-300'

/** One step of the profile-strength meter, drawn as a small arch: filled when done, outlined when not. */
function Arch({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`h-8 flex-1 rounded-t-full rounded-b-[6px] border ${done ? 'border-ink bg-ink' : 'border-stone-300 bg-transparent'}`}
    />
  )
}

export default function Profile() {
  const { data: me, isLoading } = useMeQuery()
  const bioRef = useRef<HTMLTextAreaElement>(null)
  const isMan = me?.gender === 'man'
  const { data: sent } = useSentRequestsQuery(undefined, { skip: !isMan })
  const { data: received } = useReceivedRequestsQuery(undefined, { skip: me?.gender !== 'woman' })
  const { data: chats } = useConnectionsQuery(undefined, { skip: !me })
  const [update, { isLoading: saving }] = useUpdateMeMutation()
  const dispatch = useDispatch()
  const nav = useNavigate()
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  if (isLoading || !me) return <Loading />

  const steps = [
    { label: 'Verified as a real person', done: me.status === 'active' },
    { label: 'Add your city', done: me.city.trim().length > 0 },
    { label: 'Write a few lines about you', done: me.bio.trim().length >= 20 },
    { label: "Say what you're looking for", done: me.lookingFor.trim().length > 0 },
    { label: 'Pick 3 or more interests', done: me.interests.length >= 3 },
  ]
  const doneCount = steps.filter((s) => s.done).length
  const nextStep = steps.find((s) => !s.done)
  const waiting = sent?.filter((r) => r.status === 'pending').length ?? 0
  const accepted = sent?.filter((r) => r.status === 'accepted').length ?? 0

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const f = new FormData(e.currentTarget)
    try {
      await update({
        name: String(f.get('name')),
        city: String(f.get('city')).trim(),
        bio: String(f.get('bio')),
        lookingFor: String(f.get('lookingFor')).trim(),
        interests: String(f.get('interests')).split(',').map((s) => s.trim()).filter(Boolean),
        languages: String(f.get('languages')).split(',').map((s) => s.trim()).filter(Boolean).slice(0, 8),
      }).unwrap()
      setEditing(false)
    } catch { setError('Could not save your profile.') }
  }
  function logout() {
    const token = localStorage.getItem('token')
    if (token) void unsubscribeThisDevice(token)
    dispatch(authSlice.actions.setToken(null))
    dispatch(api.util.resetApiState())
    nav('/login', { replace: true })
  }

  const initial = Array.from(me.name.trim())[0]?.toUpperCase() ?? '?'
  return (
    <PageFade className="flex flex-col gap-5 pb-6">
      <TermsGate />

      {/* Hero: the member standing in their own doorway */}
      <section aria-label="You" className={`${card} flex flex-col gap-5 !p-7`}>
        <div className="flex items-end gap-5">
          <span
            aria-hidden="true"
            className="relative inline-flex h-[120px] w-[98px] flex-none items-end justify-center rounded-t-[49px] rounded-b-[14px] bg-mist pb-4 font-display text-[48px] leading-none text-ink"
          >
            {initial}
            <span className="absolute bottom-[10px] right-[14px] h-2.5 w-2.5 rounded-full bg-ember" />
          </span>
          <div className="flex min-w-0 flex-col gap-2 pb-1">
            <h1 className="truncate font-display text-[32px] leading-tight">{me.name}</h1>
            <p className="text-sm text-slate">{me.age}{me.city ? ` · ${me.city}` : ''}</p>
            {me.status === 'active'
              ? <span className="inline-flex h-7 items-center gap-1.5 self-start rounded-full bg-sage px-3 text-xs font-medium text-verified"><CheckIcon size={12} />Real person</span>
              : <p className="text-[13px] font-medium text-slate">{me.status === 'pending' ? 'Verification under review' : 'Not verified yet'}</p>}
          </div>
        </div>
        <p className="text-xs text-slate">Member ID <code className="font-semibold text-ink">{me.memberId}</code> · members see your monogram, never a photo</p>
      </section>

      {/* Profile strength */}
      <section className={`${card} flex flex-col gap-4`} aria-labelledby="strength-title">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="strength-title" className="font-display text-xl">Profile strength</h2>
          <span className="text-sm text-slate">{doneCount} of {steps.length}</span>
        </div>
        <div role="img" aria-label={`${doneCount} of ${steps.length} steps done`} className="flex gap-2">
          {steps.map((s) => <Arch key={s.label} done={s.done} />)}
        </div>
        {nextStep ? (
          <p className="text-[15px] text-slate">
            Next: <b className="text-ink">{nextStep.label}.</b>{' '}
            {nextStep.label.startsWith('Verified')
              ? <Link to="/verify" className="font-semibold text-ink underline underline-offset-4">Verify now</Link>
              : <button type="button" onClick={() => setEditing(true)} className="font-semibold text-ink underline underline-offset-4">Add it</button>}
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-[15px] font-semibold text-verified"><CheckIcon size={16} /> Your profile is complete.</p>
        )}
      </section>

      {/* Activity, from your real requests and chats */}
      <section aria-label="Your activity" className="grid grid-cols-3 gap-3">
        {isMan ? (
          <>
            <Link to="/membership" className={`${tile}`}>
              <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.1em] text-slate"><span className="h-1.5 w-1.5 rounded-full bg-ember" />Requests left</span>
              <span className="font-display text-[34px] leading-none">{me.requestCredits}</span>
            </Link>
            <Link to="/sent" className={`${tile}`}>
              <span className="text-xs font-medium uppercase tracking-[0.1em] text-slate">Waiting</span>
              <span className="font-display text-[34px] leading-none">{waiting}</span>
            </Link>
            <Link to="/sent" className={`${tile}`}>
              <span className="text-xs font-medium uppercase tracking-[0.1em] text-slate">Said yes</span>
              <span className="font-display text-[34px] leading-none">{accepted}</span>
            </Link>
          </>
        ) : (
          <>
            <Link to="/requests" className={`${tile}`}>
              <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.1em] text-slate"><span className="h-1.5 w-1.5 rounded-full bg-ember" />Requests</span>
              <span className="font-display text-[34px] leading-none">{received?.length ?? 0}</span>
            </Link>
            <Link to="/connections" className={`${tile}`}>
              <span className="text-xs font-medium uppercase tracking-[0.1em] text-slate">Chats</span>
              <span className="font-display text-[34px] leading-none">{chats?.length ?? 0}</span>
            </Link>
            <Link to="/connections" className={`${tile}`}>
              <span className="text-xs font-medium uppercase tracking-[0.1em] text-slate">Unread</span>
              <span className="font-display text-[34px] leading-none">{chats?.reduce((n, c) => n + c.unread, 0) ?? 0}</span>
            </Link>
          </>
        )}
      </section>

      {/* About you: read view, with an edit mode */}
      {editing ? (
        <form onSubmit={submit} className={`${card} flex flex-col gap-3`} aria-label="Edit profile">
          <h2 className="font-display text-xl">Edit your profile</h2>
          <label className="flex flex-col gap-1.5 text-sm font-medium">Name
            <input name="name" defaultValue={me.name} required className={`${field} font-normal`} /></label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">City
            <input name="city" defaultValue={me.city} maxLength={60} className={`${field} font-normal`} /></label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">About me
            <textarea ref={bioRef} name="bio" defaultValue={me.bio} rows={4} maxLength={500} className={`${field} font-normal`} /></label>
          <BioPrompts onPick={(t) => { const el = bioRef.current; if (el) { el.value = (el.value.trim() ? `${el.value.trim()}\n${t}` : t).slice(0, 500); el.focus() } }} />
          <label className="flex flex-col gap-1.5 text-sm font-medium">Looking for
            <textarea name="lookingFor" defaultValue={me.lookingFor} rows={3} maxLength={300} className={`${field} font-normal`} /></label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">Interests (comma separated)
            <input name="interests" defaultValue={me.interests.join(', ')} className={`${field} font-normal`} /></label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">Languages you speak (comma separated)
            <input name="languages" defaultValue={me.languages.join(', ')} placeholder="English, Hindi" className={`${field} font-normal`} /></label>
          {error && <p role="alert" className="text-sm text-ember-deep">{error}</p>}
          <div className="flex gap-3">
            <button disabled={saving} className={`${btnPrimary} flex-1`}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => { setEditing(false); setError('') }} className={btnSecondary}>Cancel</button>
          </div>
        </form>
      ) : (
        <section className={`${card} flex flex-col gap-4`} aria-labelledby="about-title">
          <div className="flex items-center justify-between gap-3">
            <h2 id="about-title" className="font-display text-xl">What others see</h2>
            <button type="button" onClick={() => setEditing(true)} className="h-11 rounded-full bg-mist px-5 text-sm font-medium transition hover:bg-stone-200">Edit</button>
          </div>
          <div className="flex flex-col gap-1">
            <span className={eyebrow}>About me</span>
            <p className="text-[15px] leading-relaxed">{me.bio || <span className="text-slate">Add a few lines so people know who they're meeting.</span>}</p>
          </div>
          <div className="flex flex-col gap-1">
            <span className={eyebrow}>Looking for</span>
            <p className="text-[15px] leading-relaxed">{me.lookingFor || <span className="text-slate">Say what you hope to find here.</span>}</p>
          </div>
          <div className="flex flex-col gap-2">
            <span className={eyebrow}>Interests</span>
            {me.interests.length > 0
              ? <ul className="flex flex-wrap gap-2">{me.interests.map((i) => <li key={i} className={chip}>{i}</li>)}</ul>
              : <p className="text-[15px] text-slate">Pick a few things you love.</p>}
          </div>
          <div className="flex flex-col gap-2">
            <span className={eyebrow}>Languages</span>
            {me.languages.length > 0
              ? <ul className="flex flex-wrap gap-2">{me.languages.map((i) => <li key={i} className={chip}>{i}</li>)}</ul>
              : <p className="text-[15px] text-slate">Add the languages you speak.</p>}
          </div>
        </section>
      )}

      <InviteCard />
      <ShareCards bio={me.bio} />

      {/* Shortcuts */}
      <nav aria-label="Shortcuts" className="grid gap-3 sm:grid-cols-2">
        {isMan && <Link to="/membership" className={`${action} sm:col-span-2`}><span><b className="font-semibold">{plural(me.requestCredits, 'request')}</b> left · Get more</span><ChevronIcon size={20} /></Link>}
        <Link to="/settings" className={action}>Settings<ChevronIcon size={20} /></Link>
        <Link to="/settings/notifications" className={action}>Notifications<ChevronIcon size={20} /></Link>
        <Link to="/guidelines" className={action}>Community guidelines<ChevronIcon size={20} /></Link>
        <Link to="/safety" className={action}>Staying safe<ChevronIcon size={20} /></Link>
        <Link to="/help" className={action}>Help and support<ChevronIcon size={20} /></Link>
        {me.role === 'admin' && <Link to="/admin" className={`${action} sm:col-span-2`}>Admin console<ChevronIcon size={20} /></Link>}
      </nav>

      <button type="button" onClick={logout} className="h-12 rounded-full border border-stone-300 text-base font-medium transition hover:border-ink">Log out</button>
      <p className="text-center text-[13px] text-slate">{me.email}</p>
    </PageFade>
  )
}
