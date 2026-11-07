import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useDispatch } from 'react-redux'
import { authErrorMessage } from '../errors'
import { authSlice, useLoginMutation, useSignupMutation, type Gender } from '../api'
import { btnPrimary, field } from '../ui'
import { LogoMark } from '../components/icons'
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

export default function Auth({ mode }: { mode: 'login' | 'signup' }) {
  const [login, { isLoading: l1 }] = useLoginMutation()
  const [signup, { isLoading: l2 }] = useSignupMutation()
  const dispatch = useDispatch()
  const nav = useNavigate()
  const reset = (useLocation().state as { passwordReset?: boolean } | null)?.passwordReset
  const [error, setError] = useState('')

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
          }).unwrap()
      dispatch(authSlice.actions.setToken(res.token))
      nav('/wall', { replace: true })
    } catch (err) {
      setError(authErrorMessage(err))
    }
  }

  const signingUp = mode === 'signup'
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 py-8">
      <LogoMark size={44} />
      <h1 className="font-display text-[28px] font-semibold leading-tight">{signingUp ? 'Create your account' : 'Welcome back'}</h1>
      {reset && !signingUp && <p role="status" className="rounded-2xl bg-mist p-3 text-sm text-verified">Password updated. Log in with your new password.</p>}
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
        {signingUp && (
          <>
            <JoiningAs />
            <label className="flex cursor-pointer items-start gap-3 text-[13px] leading-snug text-slate">
              <input type="checkbox" required className="mt-0.5 h-5 w-5 flex-none accent-ink" />
              <span>I'm 18 or over and agree to the community values and terms.</span>
            </label>
          </>
        )}
        {error && <p role="alert" className="text-sm text-ember-deep">{error}</p>}
        <button disabled={l1 || l2} className={btnPrimary}>{signingUp ? 'Create account' : 'Log in'}</button>
      </form>
      {!signingUp && <Link className="text-sm font-medium underline" to="/forgot-password">Forgot your password?</Link>}
      <p className="text-sm text-slate">
        {signingUp ? <>Already a member? <Link className="font-semibold text-ink underline" to="/login">Log in</Link></>
          : <>New here? <Link className="font-semibold text-ink underline" to="/signup">Create an account</Link></>}
      </p>
    </div>
  )
}
