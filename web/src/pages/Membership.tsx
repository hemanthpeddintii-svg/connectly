import { useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMeQuery, useMyPaymentsQuery, usePlansQuery, useSubmitPaymentMutation, type Payment, type Plan } from '../api'
import { dateOnly, inr, plural } from '../format'
import { btnPrimary, field } from '../ui'
import PageHeader from '../components/PageHeader'
import { ErrorState, Loading } from '../components/State'
import { CheckIcon, ClockIcon, CloseIcon, UploadIcon } from '../components/icons'

const MAX_PROOF = 5 * 1024 * 1024

const ERRORS: Record<string, string> = {
  payment_pending: 'You already have a payment waiting for review.',
  reference_used: 'That transaction reference has already been used.',
  proof_reused: 'That screenshot has already been submitted.',
  unsupported_type: 'The proof must be a JPEG, PNG or WebP image.',
  file_too_large: 'The screenshot must be under 5 MB.',
  invalid_input: 'Check the reference (6–30 letters or digits) and try again.',
}

const STATUS = {
  pending: { word: 'Waiting', Icon: ClockIcon },
  approved: { word: 'Approved', Icon: CheckIcon },
  rejected: { word: 'Not approved', Icon: CloseIcon },
} as const

function Status({ s }: { s: Payment['status'] }) {
  const { word, Icon } = STATUS[s]
  return <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold"><Icon size={14} />{word}</span>
}

export default function Membership() {
  const [params] = useSearchParams()
  const { data: me } = useMeQuery(undefined, { pollingInterval: 20000 })
  const { data: plans, isError, refetch } = usePlansQuery()
  const { data: history } = useMyPaymentsQuery(undefined, { pollingInterval: 20000 })
  const [submit, { isLoading }] = useSubmitPaymentMutation()
  const [picked, setPicked] = useState<Plan['id'] | null>(params.get('pack') === 'pack20' ? 'pack20' : params.get('pack') === 'pack10' ? 'pack10' : null)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const reference = useRef<HTMLInputElement>(null)
  if (isError) return <ErrorState what="the request packs" onRetry={refetch} />
  if (!me || !plans) return <Loading />

  const pending = history?.find((p) => p.status === 'pending')
  const plan = plans.plans.find((p) => p.id === picked) ?? plans.plans[0]!
  const { upiId, payeeName } = plans.payment

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(''); setSent(false)
    const form = e.currentTarget
    const f = new FormData(form)
    const proof = f.get('proof') as File
    if (!proof?.size) return setError('Add a screenshot of your payment.')
    if (proof.size > MAX_PROOF) return setError(ERRORS.file_too_large!)
    f.set('planId', plan.id)
    try {
      await submit(f).unwrap()
      form.reset()
      setSent(true)
    } catch (err) {
      setError(ERRORS[(err as { data?: { error?: string } })?.data?.error ?? ''] ?? 'Could not submit. Please try again.')
    }
  }

  return (
    <div className="flex flex-col gap-5 pb-8">
      <PageHeader title="Get requests" back="/wall" backLabel="Back to community" />
      <p role="status" className="rounded-[22px] bg-white p-4 text-[15px] leading-normal">
        You have <b>{plural(me.requestCredits, 'request')}</b>. Each one is a knock. A member sees it, and chooses whether to accept.
      </p>

      {pending ? (
        <section aria-labelledby="pending-title" className="flex flex-col gap-3 rounded-3xl bg-white p-5">
          <h2 id="pending-title" className="font-display text-xl font-semibold">Payment submitted</h2>
          <p role="status" className="text-[15px] text-slate">Thank you. We're checking it by hand. You don't need to do anything else. This page updates when it's approved.</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[15px]">
            <dt className="text-slate">Status</dt><dd><Status s="pending" /></dd>
            <dt className="text-slate">Pack</dt><dd className="font-semibold">{plural(pending.requests, 'request')}</dd>
            <dt className="text-slate">Amount</dt><dd className="font-semibold">{inr(pending.amountPaise)}</dd>
            <dt className="text-slate">Reference</dt><dd className="font-semibold">{pending.reference}</dd>
          </dl>
        </section>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2.5">
            <legend className="mb-2 text-[15px] font-semibold">Choose a pack</legend>
            {plans.plans.map((p) => (
              <label key={p.id} className="flex min-h-16 cursor-pointer items-center justify-between rounded-2xl border border-stone-300 bg-white px-4 has-[:checked]:border-ink has-[:checked]:ring-1 has-[:checked]:ring-ink">
                <span className="flex items-center gap-3">
                  <input type="radio" name="pack" checked={p.id === plan.id} onChange={() => setPicked(p.id)} className="h-5 w-5 accent-ink" />
                  <b>{plural(p.requests, 'request')}</b>
                </span>
                <span className="font-display font-semibold">{inr(p.amountPaise)}</span>
              </label>
            ))}
          </fieldset>
          <div className="rounded-2xl bg-mist p-4 text-[15px] leading-normal">
            {upiId
              ? <p>Pay <b>{inr(plan.amountPaise)}</b> to UPI ID <b className="select-all">{upiId}</b>{payeeName ? ` (${payeeName})` : ''}, then add the details below. We check each payment by hand.</p>
              : <p className="text-slate">Payment details haven't been set up yet. Please check back soon.</p>}
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">Transaction reference
            <input ref={reference} name="reference" required minLength={6} maxLength={30} pattern="[A-Za-z0-9]{6,30}" autoComplete="off"
              placeholder="6 to 30 letters or digits" className={`${field} font-normal`} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            <span className="flex items-center gap-2"><UploadIcon size={18} />Payment screenshot (up to 5 MB)</span>
            <input name="proof" type="file" accept="image/jpeg,image/png,image/webp" required className={`${field} text-sm font-normal file:mr-3 file:rounded-full file:border-0 file:bg-mist file:px-4 file:py-2 file:font-semibold`} />
          </label>
          {error && <p role="alert" className="text-sm font-medium text-ember-deep">{error}</p>}
          {sent && <p role="status" className="text-sm font-medium text-verified">Submitted. We'll review it shortly.</p>}
          <button disabled={isLoading || !upiId} className={btnPrimary}>{isLoading ? 'Uploading…' : 'Submit payment'}</button>
        </form>
      )}

      {!!history?.length && (
        <section aria-labelledby="history-title" className="flex flex-col gap-2.5">
          <h2 id="history-title" className="font-display text-lg font-semibold">Payment history</h2>
          <ul className="flex flex-col gap-2.5">
            {history.map((p) => (
              <li key={p.id} className="flex flex-col gap-1.5 rounded-[22px] bg-white p-4">
                <div className="flex justify-between"><b>{plural(p.requests, 'request')}</b><b>{inr(p.amountPaise)}</b></div>
                <div className="flex justify-between text-[13px] text-slate"><span>{dateOnly(p.createdAt)} · Ref {p.reference}</span><Status s={p.status} /></div>
                {p.status === 'rejected' && (
                  <>
                    <p className="text-sm"><b>Reason:</b> {p.reason ?? 'Not given'}</p>
                    {!pending && (
                      <button type="button" className="h-11 self-start rounded-full bg-mist px-5 text-sm font-semibold"
                        onClick={() => { setPicked(p.planId); setSent(false); window.scrollTo({ top: 0 }); reference.current?.focus() }}>Submit again</button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-slate">Approved packs are added to your requests, and they never expire.</p>
        </section>
      )}
      <Link to="/wall" className="text-center text-sm font-semibold underline">Back to community</Link>
    </div>
  )
}
