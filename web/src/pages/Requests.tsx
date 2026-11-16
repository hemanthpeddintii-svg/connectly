import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useDispatch } from 'react-redux'
import { api, useDecideRequestMutation, useMeQuery, useReceivedRequestsQuery, type ReceivedRequest } from '../api'
import SafetyMenu from '../features/safety/SafetyMenu'
import { btnAccent, btnPrimary, btnSecondary, card, chip } from '../ui'
import { PageFade, Stagger, StaggerItem } from '../components/motion'
import Monogram from '../components/Monogram'
import RealPerson from '../components/Badge'
import Sheet from '../components/Sheet'
import { EmptyState, ErrorState, Loading } from '../components/State'
import { InfoIcon } from '../components/icons'

function RequestCard({ r }: { r: ReceivedRequest }) {
  const [decide, { isLoading }] = useDecideRequestMutation()
  const nav = useNavigate()
  const dispatch = useDispatch()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const { name, age } = r.from

  async function run(decision: 'accept' | 'decline') {
    setError('')
    try {
      const res = await decide({ id: r.id, decision }).unwrap()
      if (res.status === 'accepted') nav(`/accepted/${res.connectionId}`, { state: { name, note: r.note } })
      else setConfirming(false)
    } catch (err) {
      setConfirming(false)
      if ((err as { data?: { error?: string } })?.data?.error === 'already_decided') {
        setError('This request was already answered.')
        dispatch(api.util.invalidateTags(['Requests']))
      } else setError("That didn't go through. Try again?")
    }
  }

  return (
    <StaggerItem as="li">
      <article aria-label={`Request from ${name}, ${age}`} className={`${card} flex flex-col gap-4 !p-5`}>
        <div className="flex items-center gap-3.5">
          <Monogram name={name} size={52} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="font-display text-xl">{name}, {age}</h2>
            <RealPerson />
          </div>
          <SafetyMenu memberId={r.from.memberId} />
        </div>
        {r.note ? <p className="whitespace-pre-wrap break-words text-[15px] leading-normal">{r.note}</p>
          : <p className="text-[15px] text-slate">{name} didn't add a note.</p>}
        {(r.from.bio || r.from.interests.length > 0) && (
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-slate underline-offset-4 hover:text-ink hover:underline">About {name}</summary>
            <div className="flex flex-col gap-3 pb-1">
              {r.from.bio && <p className="whitespace-pre-wrap break-words text-[15px] leading-normal">{r.from.bio}</p>}
              {r.from.interests.length > 0 && (
                <ul className="flex flex-wrap gap-2" aria-label="Interests">{r.from.interests.map((i) => <li key={i} className={chip}>{i}</li>)}</ul>
              )}
            </div>
          </details>
        )}
        {error && <p role="alert" className="text-sm font-medium text-ember-deep">{error}</p>}
        <div className="flex gap-3">
          <button type="button" disabled={isLoading} onClick={() => void run('accept')} className={`${btnAccent} h-[50px] flex-[1.4]`}>Accept</button>
          <button type="button" disabled={isLoading} onClick={() => setConfirming(true)} className={`${btnSecondary} h-[50px] flex-1`}>Not now</button>
        </div>
      </article>
      {confirming && (
        <Sheet title={`Say not now to ${name}?`} onClose={() => setConfirming(false)}>
          <p className="text-[15px] leading-relaxed text-slate">You don't need to give a reason, and {name} won't be told why. He'll only see that you said not now.</p>
          <p className="flex items-start gap-2 text-[13px] leading-snug text-slate">
            <InfoIcon className="mt-px flex-none" size={18} />
            <span>This can't be undone. The request is closed and won't come back to your inbox.</span>
          </p>
          <div className="mt-2 flex gap-3">
            <button type="button" autoFocus onClick={() => setConfirming(false)} className={`${btnSecondary} h-[50px] flex-1`}>Keep request</button>
            <button type="button" disabled={isLoading} onClick={() => void run('decline')} className={`${btnPrimary} h-[50px] flex-1 text-base`}>
              {isLoading ? 'Saving…' : 'Not now'}
            </button>
          </div>
        </Sheet>
      )}
    </StaggerItem>
  )
}

/** The women's inbox: requests wait here until she is ready. */
export default function Requests() {
  const { data: me } = useMeQuery()
  const woman = me?.gender === 'woman'
  const { data, isLoading, isError, refetch } = useReceivedRequestsQuery(undefined, { skip: !woman })
  if (me?.gender === 'man') return <Navigate to="/wall" replace />
  if (!me || isLoading) return <Loading />
  return (
    <PageFade className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 pt-2">
        <h1 className="font-display text-[34px] leading-tight">Requests</h1>
        <p className="text-[15px] leading-snug text-slate">Members who'd like to meet you. Take your time. You choose who comes in.</p>
      </div>
      {isError ? <ErrorState what="your requests" onRetry={refetch} />
        : !data?.length ? (
          <EmptyState title="Quiet for now">
            <p>That's normal. When someone wants to say hello, their note lands here.</p>
            <p>No rush, no rules. You decide who comes in.</p>
          </EmptyState>
        ) : (
          <>
            <Stagger as="ul" className="flex flex-col gap-4">{data.map((r) => <RequestCard key={r.id} r={r} />)}</Stagger>
            <p className="text-center text-[13px] text-slate">That's everyone for now.</p>
          </>
        )}
    </PageFade>
  )
}
