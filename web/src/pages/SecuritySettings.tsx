import { useState, type FormEvent } from 'react'
import { useDispatch } from 'react-redux'
import { api, authSlice, useChangePasswordMutation, useLogoutAllMutation } from '../api'
import { authErrorMessage } from '../errors'
import { btnOutline, btnPrimary, card, field } from '../ui'

export default function SecuritySettings() {
  const dispatch = useDispatch()
  const [change, { isLoading }] = useChangePasswordMutation()
  const [logoutAll, { isLoading: signingOut }] = useLogoutAllMutation()
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(''); setSaved(false)
    const form = e.currentTarget
    const f = new FormData(form)
    const newPassword = String(f.get('next'))
    if (newPassword !== String(f.get('confirm'))) return setError("The new passwords don't match.")
    try {
      await change({ currentPassword: String(f.get('current')), newPassword }).unwrap()
      form.reset()
      setSaved(true)
    } catch (err) { setError(authErrorMessage(err)) }
  }

  async function signOutEverywhere() {
    try {
      await logoutAll().unwrap()
    } finally {
      // This device's token was revoked too, so return to the sign-in page either way.
      dispatch(authSlice.actions.setToken(null))
      dispatch(api.util.resetApiState())
    }
  }

  return (
    <section className={`${card} flex flex-col gap-4`} aria-labelledby="security-heading">
      <h2 id="security-heading" className="font-display text-2xl">Security</h2>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input name="current" type="password" required autoComplete="current-password" placeholder="Current password" className={field} />
        <input name="next" type="password" required minLength={8} maxLength={128} autoComplete="new-password" placeholder="New password" className={field} />
        <input name="confirm" type="password" required minLength={8} maxLength={128} autoComplete="new-password" placeholder="Confirm new password" className={field} />
        {error && <p role="alert" className="rounded-xl bg-ember/10 px-4 py-3 text-sm text-ember-deep">{error}</p>}
        {saved && <p role="status" className="rounded-xl bg-sage px-4 py-3 text-sm text-verified">Password changed. Your other devices were signed out.</p>}
        <button disabled={isLoading} className={`${btnPrimary} self-start`}>Change password</button>
      </form>
      <div className="flex flex-col items-start gap-3 border-t border-stone-200 pt-5">
        <p className="text-sm leading-relaxed text-slate">Lost a device, or signed in somewhere you shouldn't have? End every session, including this one.</p>
        <button onClick={signOutEverywhere} disabled={signingOut} className={btnOutline}>Sign out of all devices</button>
      </div>
    </section>
  )
}
