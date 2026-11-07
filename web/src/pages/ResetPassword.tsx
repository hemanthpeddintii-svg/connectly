import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useResetPasswordMutation } from '../api'
import { authErrorMessage } from '../errors'

export default function ResetPassword() {
  const [reset, { isLoading }] = useResetPasswordMutation()
  const [token] = useState(() => new URLSearchParams(location.search).get('token') ?? '')
  const [error, setError] = useState('')
  const nav = useNavigate()

  // Keep the one-time token out of the address bar and browser history once it has been read.
  useEffect(() => { if (token) history.replaceState(null, '', location.pathname) }, [token])

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const f = new FormData(e.currentTarget)
    const newPassword = String(f.get('password'))
    if (newPassword !== String(f.get('confirm'))) return setError("The passwords don't match.")
    try {
      await reset({ token, newPassword }).unwrap()
      nav('/login', { replace: true, state: { passwordReset: true } })
    } catch (err) { setError(authErrorMessage(err)) }
  }

  if (!token) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-3 p-6">
        <p role="alert">This reset link is incomplete. <Link className="underline" to="/forgot-password">Request a new one</Link>.</p>
      </div>
    )
  }
  const field = 'w-full rounded-md border border-stone-300 bg-white px-3 py-2 outline-none focus:border-stone-900'
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Choose a new password</h1>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" placeholder="New password" className={field} />
        <input name="confirm" type="password" required minLength={8} maxLength={128} autoComplete="new-password" placeholder="Confirm new password" className={field} />
        {error && <p role="alert" className="text-sm text-red-600">{error} {error.includes('invalid or has expired') && <Link className="underline" to="/forgot-password">Request a new link</Link>}</p>}
        <button disabled={isLoading} className="rounded-md bg-stone-900 px-3 py-2 font-medium text-white disabled:opacity-50">Save password</button>
      </form>
    </div>
  )
}
