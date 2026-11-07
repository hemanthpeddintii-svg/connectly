import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useMeQuery, useSubmitVerificationMutation } from '../api'

const MAX_SELFIE = 5 * 1024 * 1024
const MAX_VOICE = 10 * 1024 * 1024

export default function Verify() {
  // Poll while waiting so approval shows up without a manual refresh.
  const { data: me } = useMeQuery(undefined, { pollingInterval: 15000 })
  const [submit, { isLoading }] = useSubmitVerificationMutation()
  const [error, setError] = useState('')
  if (!me) return <p className="text-stone-500">Loading…</p>
  if (me.status === 'active') return <Navigate to="/wall" replace />

  if (me.status === 'pending') {
    return (
      <div role="status" className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-lg font-semibold">Under review</h2>
        <p className="mt-1 text-stone-600">We're checking your selfie and voice clip. This page updates when you're approved.</p>
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

  const field = 'block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-stone-100 file:px-3 file:py-1'
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Verify your profile</h2>
        <p className="text-stone-600">Add a clear selfie and a short voice clip so we know you're real. Only our review team can see them.</p>
      </div>
      {me.status === 'rejected' && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-red-800">
          Your last submission wasn't approved{me.rejectionReason ? `: ${me.rejectionReason}` : '.'} You can try again.
        </p>
      )}
      <label className="flex flex-col gap-1 text-sm font-medium">Selfie
        <input name="selfie" type="file" accept="image/jpeg,image/png,image/webp" capture="user" required className={field} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">Voice clip
        <input name="voice" type="file" accept="audio/*" required className={field} />
      </label>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button disabled={isLoading} className="self-start rounded-md bg-stone-900 px-4 py-2 text-white disabled:opacity-50">
        {isLoading ? 'Uploading…' : 'Submit for review'}
      </button>
    </form>
  )
}
