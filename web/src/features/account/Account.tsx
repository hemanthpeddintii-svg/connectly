import { useState, type FormEvent, type ReactNode } from 'react'
import { dateOnly, dateTime } from '../../format'
import {
  QUIET_FOREVER, useAccountQuery, useCancelDeletionMutation, useDeactivateMutation, useReactivateMutation,
  useRequestDeletionMutation, useTurnOffQuietModeMutation, useTurnOnQuietModeMutation,
} from './api'

const DURATIONS: Array<{ label: string; hours: number | null }> = [
  { label: '1 hour', hours: 1 },
  { label: '8 hours', hours: 8 },
  { label: '24 hours', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '7 days', hours: 168 },
  { label: '30 days', hours: 720 },
  { label: 'Until I turn it off', hours: null },
]
const CONFIRM_WORD = 'DELETE'
const MAX_REASON = 300

type Notice = { kind: 'ok' | 'error'; text: string } | null

const errorText = (e: unknown) => {
  const code = (e as { data?: { error?: string } })?.data?.error
  return code === 'deletion_pending'
    ? 'Cancel the deletion request first; your account stays deactivated until then.'
    : 'Something went wrong. Please try again.'
}

const button = 'rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50'
const secondary = `${button} border border-stone-300 bg-white text-stone-900`
const field = 'rounded-md border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-stone-900'

function Section({ id, title, danger, children }: { id: string; title: string; danger?: boolean; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={`flex flex-col gap-3 rounded-xl border bg-white p-5 ${danger ? 'border-red-200' : 'border-stone-200'}`}>
      <h3 id={id} className={`text-lg font-semibold ${danger ? 'text-red-700' : ''}`}>{title}</h3>
      {children}
    </section>
  )
}

function Message({ notice }: { notice: Notice }) {
  if (!notice) return null
  return notice.kind === 'error'
    ? <p role="alert" className="text-sm text-red-600">{notice.text}</p>
    : <p role="status" className="text-sm text-green-700">{notice.text}</p>
}

export default function Account() {
  // Always re-fetch on mount so the settings page never shows stale state.
  const { data, isLoading, isError, refetch } = useAccountQuery(undefined, { refetchOnMountOrArgChange: true })
  const [turnOn, { isLoading: turningOn }] = useTurnOnQuietModeMutation()
  const [turnOff, { isLoading: turningOff }] = useTurnOffQuietModeMutation()
  const [deactivate, { isLoading: deactivating }] = useDeactivateMutation()
  const [reactivate, { isLoading: reactivating }] = useReactivateMutation()
  const [requestDeletion, { isLoading: requesting }] = useRequestDeletionMutation()
  const [cancelDeletion, { isLoading: cancelling }] = useCancelDeletionMutation()

  const [duration, setDuration] = useState('24')
  const [reason, setReason] = useState('')
  const [confirm, setConfirm] = useState('')
  const [quietNotice, setQuietNotice] = useState<Notice>(null)
  const [deactivateNotice, setDeactivateNotice] = useState<Notice>(null)
  const [deleteNotice, setDeleteNotice] = useState<Notice>(null)

  if (isLoading) return <p role="status" className="text-stone-500">Loading account settings…</p>
  if (isError || !data) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
        <p>We couldn't load your account settings.</p>
        <button onClick={() => refetch()} className={secondary}>Try again</button>
      </div>
    )
  }

  async function run(action: () => Promise<unknown>, setNotice: (n: Notice) => void, success: string, after?: () => void) {
    setNotice(null)
    try {
      await action()
      setNotice({ kind: 'ok', text: success })
      after?.()
    } catch (e) {
      setNotice({ kind: 'error', text: errorText(e) })
    }
  }

  const quiet = data.quietUntil !== null
  const pending = data.deleteRequestedAt !== null

  const onQuiet = (e: FormEvent) => {
    e.preventDefault()
    const hours = duration === 'forever' ? undefined : Number(duration)
    return run(() => turnOn({ hours }).unwrap(), setQuietNotice, 'Quiet mode is on.')
  }

  const onDelete = (e: FormEvent) => {
    e.preventDefault()
    if (confirm !== CONFIRM_WORD) return
    const text = reason.trim()
    return run(() => requestDeletion(text ? { reason: text } : {}).unwrap(), setDeleteNotice, 'Deletion requested. Your account is deactivated.', () => {
      setReason('')
      setConfirm('')
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold">Your account</h2>

      <Section id="quiet-heading" title="Quiet mode">
        <p className="text-sm text-stone-600">
          Hide your profile from other members' walls while you take a break. You can still browse and chat with people you're connected to.
        </p>
        {quiet ? (
          <>
            <p role="status" className="text-sm font-medium">
              {data.quietUntil! >= QUIET_FOREVER ? 'Quiet mode is on until you turn it off.' : `Quiet mode is on until ${dateTime(data.quietUntil!)}.`}
            </p>
            <button
              onClick={() => run(() => turnOff().unwrap(), setQuietNotice, 'Quiet mode is off. You are visible again.')}
              disabled={turningOff} className={`${secondary} self-start`}
            >
              {turningOff ? 'Turning off…' : 'Turn off quiet mode'}
            </button>
          </>
        ) : (
          <form onSubmit={onQuiet} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">Duration
              <select value={duration} onChange={(e) => setDuration(e.target.value)} className={field}>
                {DURATIONS.map((d) => <option key={d.label} value={d.hours ?? 'forever'}>{d.label}</option>)}
              </select>
            </label>
            <button disabled={turningOn} className={`${button} bg-stone-900 text-white`}>{turningOn ? 'Turning on…' : 'Turn on quiet mode'}</button>
          </form>
        )}
        <Message notice={quietNotice} />
      </Section>

      <Section id="deactivate-heading" title={data.deactivated ? 'Account deactivated' : 'Deactivate account'}>
        <p className="text-sm text-stone-600">
          Deactivating hides you from the wall and from other members' connection lists, and pauses liking, skipping and messaging.
          You can still sign in, see your own data and reactivate whenever you like.
        </p>
        {data.deactivated ? (
          <>
            <p role="status" className="text-sm font-medium">Your account is deactivated and hidden from other members.</p>
            {pending && <p className="text-sm text-stone-600">Cancel your deletion request below to reactivate.</p>}
            <button
              onClick={() => run(() => reactivate().unwrap(), setDeactivateNotice, 'Your account is active again.')}
              disabled={reactivating || pending} className={`${button} self-start bg-stone-900 text-white`}
            >
              {reactivating ? 'Reactivating…' : 'Reactivate account'}
            </button>
          </>
        ) : (
          <button
            onClick={() => run(() => deactivate().unwrap(), setDeactivateNotice, 'Your account is deactivated.')}
            disabled={deactivating} className={`${secondary} self-start`}
          >
            {deactivating ? 'Deactivating…' : 'Deactivate account'}
          </button>
        )}
        <Message notice={deactivateNotice} />
      </Section>

      <Section id="delete-heading" title="Delete account" danger>
        {pending ? (
          <>
            <p role="status" className="text-sm">
              Deletion requested on {dateOnly(data.deleteRequestedAt!)}. Your account will be permanently deleted after{' '}
              <strong>{dateOnly(data.deletionDueAt!)}</strong>. Until then it stays deactivated and you can cancel.
            </p>
            <button
              onClick={() => run(() => cancelDeletion().unwrap(), setDeleteNotice, 'Deletion cancelled. Your account is active again.')}
              disabled={cancelling} className={`${button} self-start bg-stone-900 text-white`}
            >
              {cancelling ? 'Cancelling…' : 'Cancel deletion request'}
            </button>
          </>
        ) : (
          <form onSubmit={onDelete} className="flex flex-col gap-3">
            <p className="text-sm text-stone-600">
              Requesting deletion deactivates your account right away and starts a 30-day grace period. If you do nothing, your profile,
              selfie, voice clip and payment proofs are then permanently removed and you can no longer sign in. Cancel any time before then to keep your account.
            </p>
            <label className="flex flex-col gap-1 text-sm font-medium">Reason (optional)
              <textarea
                value={reason} onChange={(e) => setReason(e.target.value)} maxLength={MAX_REASON} rows={3}
                aria-describedby="reason-count" className={field}
              />
              <span id="reason-count" className="text-xs font-normal text-stone-500">{reason.length}/{MAX_REASON}</span>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Type {CONFIRM_WORD} to confirm
              <input
                value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" spellCheck={false}
                className={field}
              />
            </label>
            <button
              disabled={confirm !== CONFIRM_WORD || requesting}
              className={`${button} self-start bg-red-600 text-white`}
            >
              {requesting ? 'Requesting…' : 'Request account deletion'}
            </button>
          </form>
        )}
        <Message notice={deleteNotice} />
      </Section>
    </div>
  )
}
