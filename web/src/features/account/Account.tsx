import { useState, type FormEvent, type ReactNode } from 'react'
import { dateOnly, dateTime } from '../../format'
import {
  QUIET_FOREVER, useAccountQuery, useCancelDeletionMutation, useDeactivateMutation, useReactivateMutation,
  useRequestDeletionMutation, useTurnOffQuietModeMutation, useTurnOnQuietModeMutation,
} from './api'
import { btnOutline, btnPrimary, card, field as fieldCls } from '../../ui'

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

const secondary = btnOutline
const primary = btnPrimary
const field = fieldCls

function Section({ id, title, danger, children }: { id: string; title: string; danger?: boolean; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={`${card} flex flex-col gap-4 ${danger ? '!border-ember/30' : ''}`}>
      <h3 id={id} className={`font-display text-2xl ${danger ? 'text-ember-deep' : ''}`}>{title}</h3>
      {children}
    </section>
  )
}

function Message({ notice }: { notice: Notice }) {
  if (!notice) return null
  return notice.kind === 'error'
    ? <p role="alert" className="rounded-xl bg-ember/10 px-4 py-3 text-sm text-ember-deep">{notice.text}</p>
    : <p role="status" className="rounded-xl bg-sage px-4 py-3 text-sm text-verified">{notice.text}</p>
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

  if (isLoading) return <p role="status" className="text-sm text-slate">Loading account settings…</p>
  if (isError || !data) {
    return (
      <div role="alert" className={`${card} flex flex-col items-start gap-3 !border-ember/30 text-ember-deep`}>
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
    <div className="flex flex-col gap-5">
      <h2 className="font-display text-[30px] leading-tight">Your account</h2>

      <Section id="quiet-heading" title="Quiet mode">
        <p className="text-sm leading-relaxed text-slate">
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
            <label className="flex flex-col gap-1.5 text-sm font-medium">Duration
              <select value={duration} onChange={(e) => setDuration(e.target.value)} className={field}>
                {DURATIONS.map((d) => <option key={d.label} value={d.hours ?? 'forever'}>{d.label}</option>)}
              </select>
            </label>
            <button disabled={turningOn} className={primary}>{turningOn ? 'Turning on…' : 'Turn on quiet mode'}</button>
          </form>
        )}
        <Message notice={quietNotice} />
      </Section>

      <Section id="deactivate-heading" title={data.deactivated ? 'Account deactivated' : 'Deactivate account'}>
        <p className="text-sm leading-relaxed text-slate">
          Deactivating hides you from the wall and from other members' connection lists, and pauses liking, skipping and messaging.
          You can still sign in, see your own data and reactivate whenever you like.
        </p>
        {data.deactivated ? (
          <>
            <p role="status" className="text-sm font-medium">Your account is deactivated and hidden from other members.</p>
            {pending && <p className="text-sm leading-relaxed text-slate">Cancel your deletion request below to reactivate.</p>}
            <button
              onClick={() => run(() => reactivate().unwrap(), setDeactivateNotice, 'Your account is active again.')}
              disabled={reactivating || pending} className={`${primary} self-start`}
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
              disabled={cancelling} className={`${primary} self-start`}
            >
              {cancelling ? 'Cancelling…' : 'Cancel deletion request'}
            </button>
          </>
        ) : (
          <form onSubmit={onDelete} className="flex flex-col gap-3">
            <p className="text-sm leading-relaxed text-slate">
              Requesting deletion deactivates your account right away and starts a 30-day grace period. If you do nothing, your profile,
              selfie, voice clip and payment proofs are then permanently removed and you can no longer sign in. Cancel any time before then to keep your account.
            </p>
            <label className="flex flex-col gap-1.5 text-sm font-medium">Reason (optional)
              <textarea
                value={reason} onChange={(e) => setReason(e.target.value)} maxLength={MAX_REASON} rows={3}
                aria-describedby="reason-count" className={field}
              />
              <span id="reason-count" className="text-[13px] font-normal text-slate">{reason.length}/{MAX_REASON}</span>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Type {CONFIRM_WORD} to confirm
              <input
                value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" spellCheck={false}
                className={field}
              />
            </label>
            <button
              disabled={confirm !== CONFIRM_WORD || requesting}
              className={`${primary} self-start !bg-ember-deep hover:!bg-ember-deep/90`}
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
