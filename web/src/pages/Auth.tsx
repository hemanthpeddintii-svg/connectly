import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useSearchParams, useNavigate } from 'react-router-dom'
import { useDispatch } from 'react-redux'
import { authErrorMessage } from '../errors'
import { authSlice, useLoginMutation, useSignupMutation, type Gender } from '../api'
import { betaFullMessage, usePublicConfigQuery } from '../features/beta/api'
import { btnPrimary, field } from '../ui'
import { LogoMark } from '../components/icons'
import { useJoinWaitlistMutation, useTrackClickMutation } from '../features/admin/launch'
import JoiningAs from '../components/JoiningAs'

function Labeled({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      {children}
      {hint && <span id={`${id}-hint`} className="text-[13px] text-slate">{hint}</span>}
    </div>
  )
}

export function Waitlist() {
  const [join, { isLoading }] = useJoinWaitlistMutation()
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr('')
    const f = new FormData(e.currentTarget)
    const gender = String(f.get('wl-gender') || '') as '' | 'woman' | 'man' | 'other'
    const city = String(f.get('wl-city') || '').trim()
    let source: string | undefined
    try { source = new URLSearchParams(window.location.search).get('invite') ? 'invite_link' : 'signup' } catch { /* ignore */ }
    try {
      await join({ email: String(f.get('wl-email')).trim(), ...(city ? { city } : {}), ...(gender ? { gender } : {}), ...(source ? { source } : {}) }).unwrap()
      setDone(true)
    } catch { setErr('Could not add you. Check your email and try again.') }
  }
  if (done) return <p role="status" className="rounded-2xl bg-mist p-4 text-sm text-verified">Thank you. You're on the waitlist. We'll email you when there is a place for you.</p>
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl bg-mist p-4">
      <h2 className="font-display text-lg font-semibold">Join the waitlist</h2>
      <p className="text-sm text-slate">No code yet? Leave your email and we'll reach out when we can let more people in.</p>
      <Labeled id="wl-email" label="Email"><input id="wl-email" name="wl-email" type="email" required autoComplete="email" className={field} /></Labeled>
      <Labeled id="wl-city" label="City"><input id="wl-city" name="wl-city" autoComplete="address-level2" maxLength={60} className={field} /></Labeled>
      <Labeled id="wl-gender" label="I am (optional)">
        <select id="wl-gender" name="wl-gender" defaultValue="" className={field}><option value="">Prefer not to say</option><option value="woman">A woman</option><option value="man">A man</option><option value="other">Something else</option></select>
      </Labeled>
      {err && <p role="alert" className="text-sm text-ember-deep">{err}</p>}
      <button disabled={isLoading} className={btnPrimary}>{isLoading ? 'Joining…' : 'Join the waitlist'}</button>
    </form>
  )
}

export default function Auth({ mode }: { mode: 'login' | 'signup' }) {
  const [login, { isLoading: l1 }] = useLoginMutation()
  const [signup, { isLoading: l2 }] = useSignupMutation()
  const dispatch = useDispatch()
  const nav = useNavigate()
  const reset = (useLocation().state as { passwordReset?: boolean } | null)?.passwordReset
  const [error, setError] = useState('')
  const [params] = useSearchParams()
  const { data: cfg } = usePublicConfigQuery()
  const [trackClick] = useTrackClickMutation()
  const inviteParam = params.get('invite')
  useEffect(() => {
    if (mode !== 'signup' || !inviteParam) return
    try {
      const k = `connectly.click.${inviteParam}`
      if (sessionStorage.getItem(k)) return
      sessionStorage.setItem(k, '1')
      trackClick({ code: inviteParam }).catch(() => {})
    } catch { /* storage blocked: skip tracking */ }
  }, [mode, inviteParam, trackClick])
  const [needsWaitlist, setNeedsWaitlist] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const f = new FormData(e.currentTarget)
    const email = String(f.get('email'))
    const password = String(f.get('password'))
    try {
      const res = mode === 'login'
        ? await login({ email, password }).unwrap()
        : await signup({
            email, password,
            name: String(f.get('name')),
            age: Number(f.get('age')),
            gender: f.get('joining-as') as Gender,
            agreeToTerms: true,
            ...(String(f.get('invite') ?? '').trim() ? { inviteCode: String(f.get('invite')).trim() } : {}),
          }).unwrap()
      dispatch(authSlice.actions.setToken(res.token))
      nav(mode === 'signup' ? '/setup' : '/wall', { replace: true })
    } catch (err) {
      const code = (err as { data?: { error?: string } })?.data?.error
      if (mode === 'signup' && (code === 'invite_invalid' || code === 'beta_full')) setNeedsWaitlist(true)
      setError(betaFullMessage(err, cfg?.betaCity) ?? authErrorMessage(err))
    }
  }

  const signingUp = mode === 'signup'
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 py-8">
      <LogoMark size={44} />
      <h1 className="font-display text-[28px] font-semibold leading-tight">{signingUp ? 'Create your account' : 'Welcome back'}</h1>
      {reset && !signingUp && <p role="status" className="rounded-2xl bg-mist p-3 text-sm text-verified">Password updated. Log in with your new password.</p>}
      {signingUp && cfg?.betaCity && <p className="-mt-3 text-sm text-slate">We're opening in {cfg.betaCity} first{cfg.inviteOnly ? ', by invite only' : ''}.</p>}
      <form onSubmit={submit} className="flex flex-col gap-4">
        {signingUp && (
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <Labeled id="name" label="First name">
              <input id="name" name="name" placeholder="Maya" required autoComplete="given-name" className={field} />
            </Labeled>
            <Labeled id="age" label="Age (18+)">
              <input id="age" name="age" type="number" min={18} max={120} inputMode="numeric" placeholder="18+" required className={field} />
            </Labeled>
          </div>
        )}
        <Labeled id="email" label="Email">
          <input id="email" name="email" type="email" placeholder="you@example.com" required autoComplete="email" className={field} />
        </Labeled>
        <Labeled id="password" label="Password" hint={signingUp ? '8+ characters, nothing too common.' : undefined}>
          <input id="password" name="password" type="password" minLength={8} placeholder={signingUp ? 'Create a password' : 'Your password'} required
            aria-describedby={signingUp ? 'password-hint' : undefined}
            autoComplete={signingUp ? 'new-password' : 'current-password'} className={field} />
        </Labeled>
        {signingUp && cfg?.inviteOnly && (
          <Labeled id="invite" label="Invite code" hint="Connectly is invite only right now. Ask a member for their code.">
            <input id="invite" name="invite" required defaultValue={params.get('invite') ?? ''} autoComplete="off" autoCapitalize="characters" className={field} />
          </Labeled>
        )}
        {signingUp && (
          <>
            <JoiningAs />
            <label className="flex cursor-pointer items-start gap-3 text-[13px] leading-snug text-slate">
              <input type="checkbox" required className="mt-0.5 h-5 w-5 flex-none accent-ink" />
              <span>I'm 18 or over and agree to the <Link className="font-semibold text-ink underline" to="/values">community values</Link> and <Link className="font-semibold text-ink underline" to="/legal/terms">terms</Link>.</span>
            </label>
          </>
        )}
        {error && <p role="alert" className="text-sm text-ember-deep">{error}</p>}
        <button disabled={l1 || l2} className={btnPrimary}>{signingUp ? 'Create account' : 'Log in'}</button>
      </form>
      {signingUp && cfg?.inviteOnly && (needsWaitlist || !inviteParam) && <Waitlist />}
      {!signingUp && <Link className="text-sm font-medium underline" to="/forgot-password">Forgot your password?</Link>}
      <p className="text-sm text-slate">
        {signingUp ? <>Already a member? <Link className="font-semibold text-ink underline" to="/login">Log in</Link></>
          : <>New here? <Link className="font-semibold text-ink underline" to="/signup">Create an account</Link></>}
      </p>
    </div>
  )
}
