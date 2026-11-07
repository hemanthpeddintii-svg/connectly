import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useForgotPasswordMutation } from '../api'
import { authErrorMessage } from '../errors'

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
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      {done ? (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-emerald-900">
          If an account exists for that email, we've sent a link to reset the password. It expires in 30 minutes.
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <p className="text-sm text-stone-600">Enter your email and we'll send you a reset link.</p>
          <input name="email" type="email" required autoComplete="email" placeholder="Email"
            className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 outline-none focus:border-stone-900" />
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <button disabled={isLoading} className="rounded-md bg-stone-900 px-3 py-2 font-medium text-white disabled:opacity-50">Send reset link</button>
        </form>
      )}
      <Link className="text-sm underline" to="/login">Back to log in</Link>
    </div>
  )
}
