import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useForgotPasswordMutation } from '../api'
import { authErrorMessage } from '../errors'
import { btnPrimary, field } from '../ui'
import { LogoMark } from '../components/icons'
import { PageFade } from '../components/motion'

export default function ForgotPassword() {
  const [send, { isLoading }] = useForgotPasswordMutation()
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    try {
      await send({ email: String(new FormData(e.currentTarget).get('email')) }).unwrap()
      setDone(true)
    } catch (err) { setError(authErrorMessage(err)) }
  }

  return (
    <PageFade className="mx-auto flex min-h-dvh max-w-md flex-col gap-7 px-5 py-8">
      <Link to="/" aria-label="Back to the home page" className="self-start"><LogoMark size={40} /></Link>
      <h1 className="font-display text-[38px] leading-[1.05]">Reset your password</h1>
      {done ? (
        <p role="status" className="rounded-2xl bg-sage p-4 text-sm text-verified">
          If an account exists for that email, we've sent a link to reset the password. It expires in 30 minutes.
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <p className="text-[15px] text-slate">Enter your email and we'll send you a reset link.</p>
          <input name="email" type="email" required autoComplete="email" placeholder="Email" aria-label="Email" className={field} />
          {error && <p role="alert" className="rounded-xl bg-ember/10 px-4 py-3 text-sm text-ember-deep">{error}</p>}
          <button disabled={isLoading} className={btnPrimary}>Send reset link</button>
        </form>
      )}
      <Link className="text-sm font-medium underline" to="/login">Back to log in</Link>
    </PageFade>
  )
}
