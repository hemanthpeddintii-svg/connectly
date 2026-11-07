import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useMeQuery, useSubmitVerificationMutation } from '../api'
import { btnPrimary, field as fieldCls } from '../ui'
import { Loading } from '../components/State'
import TermsGate from '../features/onboarding/TermsGate'

const MAX_SELFIE = 5 * 1024 * 1024
const MAX_VOICE = 10 * 1024 * 1024

export default function Verify() {
  // Poll while waiting so approval shows up without a manual refresh.
  const { data: me } = useMeQuery(undefined, { pollingInterval: 15000 })
  const [submit, { isLoading }] = useSubmitVerificationMutation()
  const [error, setError] = useState('')
  if (!me) return <Loading />
  if (me.status === 'active') return <Navigate to="/wall" replace />

  if (me.status === 'pending') {
    return (
      <div className="flex flex-col gap-4 pb-4">
        <TermsGate />
        <h1 className="font-display text-[28px] font-semibold leading-tight">The door is ajar.</h1>
        <p role="status" className="text-[15px] text-slate">Thanks for sending your selfie and voice clip. Our team is taking a careful look before anyone else meets you.</p>
        <section className="rounded-3xl bg-white p-5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-ember-deep">What we're checking</h2>
          <ul className="mt-2 list-disc pl-5 text-[15px]">
            <li>Your selfie shows a clear face, and it's really you</li>
            <li>Your voice clip is a real, live voice</li>
            <li>Your details match, and you're 18 or over</li>
          </ul>
        </section>
        <section className="rounded-3xl bg-white p-5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-ember-deep">What happens next</h2>
          <p className="mt-2 text-[15px] text-slate">We'll tell you the result right here. Once approved, you'll get a "Real person" badge and the community opens. If we need another try, we'll say exactly why. Nothing for you to do, and you can close the app.</p>
        </section>
      </div>
    )
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const f = new FormData(e.currentTarget)
    const selfie = f.get('selfie') as File
    const voice = f.get('voice') as File
    if (!selfie?.size || !voice?.size) return setError('Please add both a selfie and a voice clip.')
    if (selfie.size > MAX_SELFIE) return setError('Selfie must be under 5 MB.')
    if (voice.size > MAX_VOICE) return setError('Voice clip must be under 10 MB.')
    try {
      await submit(f).unwrap()
    } catch (err: any) {
      const d = err?.data
      setError(
        d?.error === 'unsupported_type'
          ? `That ${d.field === 'voice' ? 'audio' : 'image'} format isn't supported. Use ${d.field === 'voice' ? 'WebM, Ogg, M4A, MP3 or WAV' : 'JPEG, PNG or WebP'}.`
          : d?.error === 'file_too_large' ? 'One of the files is too large.'
          : d?.error === 'cannot_submit' ? 'Your submission is already being reviewed.'
          : 'Upload failed. Please try again.',
      )
    }
  }

  const rejected = me.status === 'rejected'
  const fileField = `${fieldCls} file:mr-3 file:rounded-full file:border-0 file:bg-mist file:px-3 file:py-1`
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 pb-4">
      <TermsGate />
      <div>
        <h1 className="font-display text-[28px] font-semibold leading-tight">{rejected ? "We couldn't approve this one" : 'Verify your profile'}</h1>
        <p className="mt-1 text-[15px] text-slate">
          {rejected ? "That's okay, it happens. Nothing is wrong with your account. Here's what our team saw, and how to fix it."
            : "Add a clear selfie and a short voice clip so we know you're real. Only our review team can see them."}
        </p>
      </div>
      {rejected && (
        <>
          <div role="alert" className="rounded-3xl bg-white p-5">
            <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-ember-deep">Note from the review team</h2>
            <p className="mt-1 text-base font-semibold">{me.rejectionReason || 'No reason was given.'}</p>
          </div>
          <div className="rounded-3xl bg-white p-5 text-[15px]">
            <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-ember-deep">For a better selfie</h2>
            <ul className="mt-1 list-disc pl-5"><li>Face the light, so your face isn't in shadow</li><li>No sunglasses, hat or filters. Just you</li><li>Hold the phone steady, at eye level</li></ul>
            <h2 className="mt-3 text-xs font-semibold uppercase tracking-[0.08em] text-ember-deep">For a better voice clip</h2>
            <ul className="mt-1 list-disc pl-5"><li>Find a quiet spot, away from music and traffic</li><li>Say hello in your own words, a few clear sentences</li></ul>
          </div>
        </>
      )}
      <label className="flex flex-col gap-1.5 text-sm font-semibold">Selfie
        <input name="selfie" type="file" accept="image/jpeg,image/png,image/webp" capture="user" required className={fileField} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">Voice clip
        <input name="voice" type="file" accept="audio/*" required className={fileField} />
      </label>
      {error && <p role="alert" className="text-sm text-ember-deep">{error}</p>}
      <button disabled={isLoading} className={btnPrimary}>
        {isLoading ? 'Uploading…' : rejected ? 'Try again' : 'Submit for review'}
      </button>
      <p className="text-center text-[13px] text-slate">Your selfie and clip are only ever seen by our review team.</p>
    </form>
  )
}
