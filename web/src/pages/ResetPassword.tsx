import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useResetPasswordMutation } from '../api'
import { authErrorMessage } from '../errors'
import { btnPrimary, field } from '../ui'
import { LogoMark } from '../components/icons'
import { PageFade } from '../components/motion'

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
      <PageFade className="mx-auto flex min-h-dvh max-w-md flex-col gap-7 px-5 py-8">
        <Link to="/" aria-label="Back to the home page" className="self-start"><LogoMark size={40} /></Link>
        <p role="alert" className="text-[15px] text-slate">This reset link is incomplete. <Link className="font-semibold text-ink underline" to="/forgot-password">Request a new one</Link>.</p>
      </PageFade>
    )
  }
  return (
    <PageFade className="mx-auto flex min-h-dvh max-w-md flex-col gap-7 px-5 py-8">
      <Link to="/" aria-label="Back to the home page" className="self-start"><LogoMark size={40} /></Link>
      <h1 className="font-display text-[38px] leading-[1.05]">Choose a new password</h1>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <input name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" placeholder="New password" aria-label="New password" className={field} />
        <input name="confirm" type="password" required minLength={8} maxLength={128} autoComplete="new-password" placeholder="Confirm new password" aria-label="Confirm new password" className={field} />
        {error && <p role="alert" className="rounded-xl bg-ember/10 px-4 py-3 text-sm text-ember-deep">{error} {error.includes('invalid or has expired') && <Link className="font-semibold underline" to="/forgot-password">Request a new link</Link>}</p>}
        <button disabled={isLoading} className={btnPrimary}>Save password</button>
      </form>
    </PageFade>
  )
}
