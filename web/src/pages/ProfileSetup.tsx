import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useMeQuery, useUpdateMeMutation } from '../api'
import { btnOutline, btnPrimary, field } from '../ui'
import { CheckIcon } from '../components/icons'
import { Loading } from '../components/State'
import TermsGate from '../features/onboarding/TermsGate'

const SUGGESTED = ['Climbing', 'Jazz', 'Cooking', 'Hiking', 'Cinema', 'Reading', 'Travel', 'Board games', 'Photography', 'Running', 'Gardening', 'Yoga', 'Live music', 'Poetry', 'Football', 'Baking', 'Cycling', 'Languages']
const MAX_INTERESTS = 12

export default function ProfileSetup() {
  const { data: me } = useMeQuery()
  const [update, { isLoading }] = useUpdateMeMutation()
  const nav = useNavigate()
  const [step, setStep] = useState(1)
  const [city, setCity] = useState('')
  const [languages, setLanguages] = useState('')
  const [bio, setBio] = useState('')
  const [lookingFor, setLookingFor] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [error, setError] = useState('')
  if (!me) return <Loading />
  const next = me.status === 'active' ? '/wall' : '/verify'

  const toggle = (t: string) => setPicked((p) => p.includes(t) ? p.filter((x) => x !== t) : p.length >= MAX_INTERESTS ? p : [...p, t])

  async function finish(skip: boolean) {
    setError('')
    const body = skip ? {} : { city: city.trim(), languages: languages.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 8), bio: bio.trim(), lookingFor: lookingFor.trim(), interests: picked }
    try {
      if (Object.keys(body).length) await update(body).unwrap()
      nav(next, { replace: true })
    } catch { setError('Could not save your profile. Please try again.') }
  }

  if (!me.termsAgreed) return <TermsGate />
  if (me.status === 'deleted') return <Navigate to="/" replace />

  return (
    <div className="flex flex-col gap-5 pb-6">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ember-deep">Step {step} of 2</p>
      {step === 1 ? (
        <>
          <div>
            <h1 className="font-display text-[28px] font-semibold leading-tight">About you</h1>
            <p className="mt-1 text-[15px] text-slate">Members meet through words, not photos. Say it in your own voice.</p>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">City
            <input value={city} onChange={(e) => setCity(e.target.value)} maxLength={60} autoComplete="address-level2" className={`${field} font-normal`} /></label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">Languages you speak
            <input value={languages} onChange={(e) => setLanguages(e.target.value)} placeholder="English, Hindi" className={`${field} font-normal`} />
            <span className="text-[13px] font-normal text-slate">Comma separated. Helps people who share a language find you.</span></label>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="bio" className="text-sm font-semibold">About me</label>
            <textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={5} maxLength={500} aria-describedby="bio-count" className={`${field}`} />
            <span id="bio-count" className="self-end text-[13px] text-slate">{bio.length} / 500</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="looking" className="text-sm font-semibold">Looking for</label>
            <textarea id="looking" value={lookingFor} onChange={(e) => setLookingFor(e.target.value)} rows={3} maxLength={300} aria-describedby="looking-count" className={field} />
            <span id="looking-count" className="self-end text-[13px] text-slate">{lookingFor.length} / 300</span>
          </div>
          <button type="button" onClick={() => setStep(2)} className={btnPrimary}>Continue</button>
          <button type="button" onClick={() => setStep(2)} className={btnOutline}>Skip for now</button>
        </>
      ) : (
        <>
          <div>
            <h1 className="font-display text-[28px] font-semibold leading-tight">Interests</h1>
            <p className="mt-1 text-[15px] text-slate">Pick up to {MAX_INTERESTS} things you enjoy. They help the right people find you.</p>
          </div>
          <ul className="flex flex-wrap gap-2">
            {SUGGESTED.map((t) => {
              const on = picked.includes(t)
              return (
                <li key={t}>
                  <button type="button" aria-pressed={on} onClick={() => toggle(t)}
                    className={`inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium ${on ? 'bg-ink text-paper' : 'bg-mist text-ink'}`}>
                    {on && <CheckIcon size={12} />}{t}
                  </button>
                </li>
              )
            })}
          </ul>
          <p role="status" className="text-[13px] text-slate">{picked.length} of {MAX_INTERESTS} chosen</p>
          {error && <p role="alert" className="text-sm text-ember-deep">{error}</p>}
          <button type="button" disabled={isLoading} onClick={() => void finish(false)} className={btnPrimary}>{isLoading ? 'Saving…' : 'Finish'}</button>
          <button type="button" disabled={isLoading} onClick={() => void finish(true)} className={btnOutline}>Skip for now</button>
          <button type="button" onClick={() => setStep(1)} className="text-sm font-semibold underline">Back</button>
        </>
      )}
    </div>
  )
}
