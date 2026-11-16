import { useState, type FormEvent, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useMeQuery, useSubmitVerificationMutation } from '../api'
import { btnPrimary, card, eyebrow, field as fieldCls } from '../ui'
import { CheckIcon } from '../components/icons'
import { PageFade, Stagger, StaggerItem } from '../components/motion'
import { Loading } from '../components/State'
import SupportContact from '../components/SupportContact'
import TermsGate from '../features/onboarding/TermsGate'

function HowItWorks() {
  const steps = [
    'Send a selfie and a short voice clip.',
    'A person on our team reviews them. Only the review team sees them, never other members.',
    'Once the review is decided, we delete both files and you see "Verified".',
  ]
  return (
    <section aria-labelledby="how-v" className={`${card} flex flex-col gap-4`}>
      <h2 id="how-v" className={eyebrow}>How verification works</h2>
      <ol className="flex flex-col gap-3 text-[15px] leading-relaxed">
        {steps.map((t, n) => (
          <li key={t} className="flex gap-3"><span aria-hidden="true" className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-mist text-xs font-medium">{n + 1}</span><span>{t}</span></li>
        ))}
      </ol>
    </section>
  )
}

/** One step of the submission: a numbered card that turns sage once its file is chosen. */
function FileStep({ n, title, hint, done, name, children }: { n: number; title: string; hint: string; done: boolean; name?: string; children: ReactNode }) {
  return (
    <div className={`${card} flex flex-col gap-3 transition-colors duration-300 ${done ? '!border-verified/30' : ''}`}>
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className={`flex h-8 w-8 flex-none items-center justify-center rounded-full text-sm font-medium transition-colors duration-300 ${done ? 'bg-sage text-verified' : 'bg-mist text-ink'}`}>
          {done ? <CheckIcon size={14} /> : n}
        </span>
        <div className="min-w-0">
          <p className="font-display text-xl leading-tight">{title}</p>
          <p className="truncate text-[13px] text-slate">{done && name ? name : hint}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

const MAX_SELFIE = 5 * 1024 * 1024
const MAX_VOICE = 10 * 1024 * 1024

export default function Verify() {
  // Poll while waiting so approval shows up without a manual refresh.
  const { data: me } = useMeQuery(undefined, { pollingInterval: 15000 })
  const [submit, { isLoading }] = useSubmitVerificationMutation()
  const [error, setError] = useState('')
  const [selfieName, setSelfieName] = useState('')
  const [voiceName, setVoiceName] = useState('')
  if (!me) return <Loading />
  if (me.status === 'active') return <Navigate to="/wall" replace />

  if (me.status === 'pending') {
    return (
      <PageFade className="flex flex-col gap-5 pb-4">
        <TermsGate />
        <h1 className="font-display text-[34px] leading-[1.1]">The door is ajar.</h1>
        <p role="status" className="text-[15px] leading-relaxed text-slate">Thanks for sending your selfie and voice clip. Our team is taking a careful look before anyone else meets you.</p>
        <section className={`${card} flex flex-col gap-3`}>
          <h2 className={eyebrow}>What we're checking</h2>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[15px] marker:text-stone-300">
            <li>Your selfie shows a clear face, and it's really you</li>
            <li>Your voice clip is a real, live voice</li>
            <li>Your details match, and you're 18 or over</li>
          </ul>
        </section>
        <section className={`${card} flex flex-col gap-3`}>
          <h2 className={eyebrow}>What happens next</h2>
          <p className="text-[15px] leading-relaxed text-slate">We'll tell you the result right here. Once approved, you'll get a "Real person" badge and the community opens. If we need another try, we'll say exactly why. Nothing for you to do, and you can close the app.</p>
          <p className="text-[15px] leading-relaxed text-slate">Once the review is decided, we delete your selfie and voice clip.</p>
        </section>
        <SupportContact />
      </PageFade>
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
  const fileField = `${fieldCls} file:mr-3 file:rounded-full file:border-0 file:bg-mist file:px-4 file:py-1.5 file:font-medium`
  const added = (selfieName ? 1 : 0) + (voiceName ? 1 : 0)
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5 pb-4">
      <TermsGate />
      <PageFade>
        <h1 className="font-display text-[34px] leading-[1.1]">{rejected ? "We couldn't approve this one" : 'Verify your profile'}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-slate">
          {rejected ? "That's okay, it happens. Nothing is wrong with your account. Here's what our team saw, and how to fix it."
            : "Add a clear selfie and a short voice clip so we know you're real. Only our review team can see them."}
        </p>
      </PageFade>
      {!rejected && <HowItWorks />}
      {rejected && (
        <>
          <p className="text-[15px] text-slate">Your earlier selfie and voice clip were deleted once the review was decided, so you will need to send new ones.</p>
          <div role="alert" className={`${card} flex flex-col gap-1.5`}>
            <h2 className={eyebrow}>Note from the review team</h2>
            <p className="text-base font-medium">{me.rejectionReason || 'No reason was given.'}</p>
          </div>
          <div className={`${card} text-[15px] leading-relaxed`}>
            <h2 className={eyebrow}>For a better selfie</h2>
            <ul className="mt-2 list-disc pl-5 marker:text-stone-300"><li>Face the light, so your face isn't in shadow</li><li>No sunglasses, hat or filters. Just you</li><li>Hold the phone steady, at eye level</li></ul>
            <h2 className={`${eyebrow} mt-5`}>For a better voice clip</h2>
            <ul className="mt-2 list-disc pl-5 marker:text-stone-300"><li>Find a quiet spot, away from music and traffic</li><li>Say hello in your own words, a few clear sentences</li></ul>
          </div>
        </>
      )}
      <p role="status" className="text-[13px] text-slate">{added} of 2 added</p>
      <div aria-hidden="true" className="-mt-3 flex gap-2">
        {[0, 1].map((n) => <span key={n} className={`h-1 flex-1 rounded-full transition-colors duration-500 ${n < added ? 'bg-verified' : 'bg-stone-200'}`} />)}
      </div>
      <Stagger className="flex flex-col gap-4">
        <StaggerItem>
          <FileStep n={1} title="Selfie" hint="A clear photo of your face, in good light" done={!!selfieName} name={selfieName}>
            <label className="flex flex-col gap-1.5 text-sm font-medium"><span className="sr-only">Selfie</span>
              <input name="selfie" type="file" accept="image/jpeg,image/png,image/webp" capture="user" required className={fileField}
                onChange={(e) => setSelfieName(e.target.files?.[0]?.name ?? '')} />
            </label>
          </FileStep>
        </StaggerItem>
        <StaggerItem>
          <FileStep n={2} title="Voice clip" hint="A few clear sentences, in your own words" done={!!voiceName} name={voiceName}>
            <label className="flex flex-col gap-1.5 text-sm font-medium"><span className="sr-only">Voice clip</span>
              <input name="voice" type="file" accept="audio/*" required className={fileField}
                onChange={(e) => setVoiceName(e.target.files?.[0]?.name ?? '')} />
            </label>
          </FileStep>
        </StaggerItem>
      </Stagger>
      {error && <p role="alert" className="rounded-xl bg-ember/10 px-4 py-3 text-sm text-ember-deep">{error}</p>}
      <button disabled={isLoading} className={btnPrimary}>
        {isLoading ? 'Uploading…' : rejected ? 'Try again' : 'Submit for review'}
      </button>
      <p className="text-center text-[13px] text-slate">Only our review team sees your selfie and clip. Both files are deleted once the review is decided.</p>
      <SupportContact className="text-center text-slate" />
    </form>
  )
}
