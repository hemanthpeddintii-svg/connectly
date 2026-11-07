import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMeQuery, useSendRequestMutation, useWallQuery } from '../api'
import { plural } from '../format'
import { btnOutline, btnPrimary, card, field } from '../ui'
import Monogram from '../components/Monogram'
import RealPerson from '../components/Badge'
import OutOfRequests from '../components/OutOfRequests'
import PageHeader from '../components/PageHeader'
import { Loading } from '../components/State'
import { CheckIcon } from '../components/icons'

const MAX_NOTE = 300

const sendError = (err: unknown) => {
  const code = (err as { data?: { error?: string } })?.data?.error
  if (code === 'already_requested') return "You've already sent a request to this member."
  if (code === 'not_found') return 'This member is no longer available.'
  if (code === 'invalid_input') return `Keep your note to ${MAX_NOTE} characters or fewer.`
  return "Couldn't send your request. Please try again."
}

export default function SendRequest() {
  const { bumpId = '' } = useParams()
  const { data: me } = useMeQuery()
  const { data: wall, isLoading } = useWallQuery()
  const [send, { isLoading: sending }] = useSendRequestMutation()
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [noCredits, setNoCredits] = useState(false)
  // The member leaves the community list the moment the request lands, so keep their name for the confirmation.
  const [sent, setSent] = useState<{ name: string; creditsLeft: number } | null>(null)

  if (!me || (isLoading && !sent)) return <Loading />
  const p = wall?.find((m) => m.bumpId === bumpId)

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-6 pt-10 text-center">
        <div className="flex flex-col items-center gap-3">
          <svg aria-hidden="true" viewBox="0 0 256 256" width="120" height="120">
            <path fill="var(--color-ink)" d="M36,220V128A92,92 0 0 1 220,128V220H176V128A48,48 0 0 0 80,128V220Z" />
            <rect className="knock-pulse-late" x="120" y="96" width="16" height="124" rx="8" fill="var(--color-ember)" />
          </svg>
          <h1 className="font-display text-[28px] font-semibold leading-tight">Request sent to {sent.name}</h1>
          <p role="status" className="max-w-sm text-[15px] leading-relaxed text-slate">
            She'll see your note and can accept or say not now. If she accepts, a chat opens for you both.
          </p>
        </div>
        <div className="flex w-full items-center gap-3 rounded-3xl bg-white p-4 text-left">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-mist"><CheckIcon size={20} /></span>
          <div className="flex flex-col">
            <b>{plural(sent.creditsLeft, 'request')} left</b>
            <span className="text-[13px] text-slate">Each request uses 1, whatever the answer.</span>
          </div>
        </div>
        <div className="flex w-full flex-col gap-3">
          <Link to="/wall" className={btnPrimary}>Back to community</Link>
          <Link to="/sent" className={btnOutline}>See requests you've sent</Link>
        </div>
      </div>
    )
  }

  if (me.requestCredits <= 0 || noCredits) return <OutOfRequests />

  if (!p) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Send a request" back="/wall" backLabel="Back to community" />
        <p role="alert" className="text-slate">This member isn't available any more. <Link to="/wall" className="font-semibold text-ink underline">Back to community</Link></p>
      </div>
    )
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!p) return
    setError('')
    try {
      const res = await send({ bumpId: p.bumpId, note: note.trim() || undefined }).unwrap()
      setSent({ name: p.name, creditsLeft: res.creditsLeft })
    } catch (err) {
      if ((err as { status?: number })?.status === 402) setNoCredits(true)
      else setError(sendError(err))
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-1 flex-col gap-5">
      <PageHeader title="Send a request" back="/wall" backLabel="Back to community" />
      <div className={`${card} flex items-center gap-3.5 !rounded-[22px] !p-4`}>
        <Monogram name={p.name} size={52} />
        <div className="flex flex-col gap-1">
          <b className="font-display text-lg font-semibold">{p.name}, {p.age}</b>
          <RealPerson />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="note" className="text-[15px] font-semibold">Add a short note</label>
        <textarea id="note" rows={5} maxLength={MAX_NOTE} value={note} onChange={(e) => setNote(e.target.value)}
          aria-describedby="note-help note-count"
          placeholder={`Say hello in your own words. What caught your eye about ${p.name}'s profile?`}
          className={`${field} resize-none leading-normal`} />
        <div className="flex items-start justify-between gap-3 text-[13px] leading-snug text-slate">
          <span id="note-help">{p.name} will read your note with your request. She can accept, or say not now.</span>
          <span id="note-count" className="flex-none tabular-nums">{note.length}/{MAX_NOTE}</span>
        </div>
      </div>
      {error && <p role="alert" className="text-sm font-medium text-ember-deep">{error}</p>}
      <div className="mt-auto flex flex-col gap-2.5 pb-6">
        <button disabled={sending} className={btnPrimary}>{sending ? 'Sending…' : 'Send request'}</button>
        <span className="text-center text-[13px] text-slate">Uses 1 of your {plural(me.requestCredits, 'request')}</span>
      </div>
    </form>
  )
}
