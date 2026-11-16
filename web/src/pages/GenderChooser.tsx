import { useState, type FormEvent } from 'react'
import { useUpdateMeMutation, type Gender } from '../api'
import { betaFullMessage, usePublicConfigQuery } from '../features/beta/api'
import { btnPrimary } from '../ui'
import { LogoMark } from '../components/icons'
import JoiningAs from '../components/JoiningAs'
import { PageFade } from '../components/motion'

/** One-time question for accounts created before gender was collected. */
export default function GenderChooser() {
  const [update, { isLoading }] = useUpdateMeMutation()
  const { data: cfg } = usePublicConfigQuery()
  const [error, setError] = useState('')

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const gender = new FormData(e.currentTarget).get('joining-as') as Gender | null
    if (!gender) return setError('Choose how you are joining.')
    try { await update({ gender }).unwrap() } catch (err) { setError(betaFullMessage(err, cfg?.betaCity) ?? 'Could not save that. Please try again.') }
  }

  return (
    <PageFade className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-8">
    <form onSubmit={submit} className="flex flex-col gap-6">
      <LogoMark size={44} />
      <div>
        <h1 className="font-display text-[34px] leading-[1.1]">How are you joining?</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-slate">Connectly works a little differently for each side. You can't change this later, so choose what fits.</p>
      </div>
      <JoiningAs />
      {error && <p role="alert" className="rounded-xl bg-ember/10 px-4 py-3 text-sm text-ember-deep">{error}</p>}
      <button disabled={isLoading} className={btnPrimary}>{isLoading ? 'Saving…' : 'Continue'}</button>
    </form>
    </PageFade>
  )
}
