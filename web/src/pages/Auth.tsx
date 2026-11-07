import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useDispatch } from 'react-redux'
import { authErrorMessage } from '../errors'
import { authSlice, useLoginMutation, useSignupMutation } from '../api'

const input = 'w-full rounded-md border border-stone-300 bg-white px-3 py-2 outline-none focus:border-stone-900'

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
            interests: String(f.get('interests') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
          }).unwrap()
      dispatch(authSlice.actions.setToken(res.token))
      nav('/wall', { replace: true })
    } catch (err: any) {
      setError(authErrorMessage(err))
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">{mode === 'login' ? 'Welcome back' : 'Create your profile'}</h1>
      {reset && mode === 'login' && <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">Password updated. Log in with your new password.</p>}
      <form onSubmit={submit} className="flex flex-col gap-3">
        {mode === 'signup' && (
          <>
            <input name="name" placeholder="First name" required className={input} />
            <input name="age" type="number" min={18} max={120} placeholder="Age" required className={input} />
            <input name="interests" placeholder="Interests (comma separated)" className={input} />
          </>
        )}
        <input name="email" type="email" placeholder="Email" required autoComplete="email" className={input} />
        <input name="password" type="password" minLength={8} placeholder="Password" required
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'} className={input} />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button disabled={l1 || l2} className="rounded-md bg-stone-900 px-3 py-2 font-medium text-white disabled:opacity-50">
          {mode === 'login' ? 'Log in' : 'Sign up'}
        </button>
      </form>
      {mode === 'login' && <Link className="text-sm underline" to="/forgot-password">Forgot your password?</Link>}
      <p className="text-sm text-stone-600">
        {mode === 'login' ? <>New here? <Link className="underline" to="/signup">Sign up</Link></>
          : <>Have an account? <Link className="underline" to="/login">Log in</Link></>}
      </p>
    </div>
  )
}
