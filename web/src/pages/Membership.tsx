import { useState, type FormEvent } from 'react'
import { useMeQuery, useMyPaymentsQuery, usePlansQuery, useSubmitPaymentMutation } from '../api'
import { dateOnly, dateTime, inr } from '../format'

const MAX_PROOF = 5 * 1024 * 1024
const field = 'w-full rounded-md border border-stone-300 bg-white px-3 py-2 outline-none focus:border-stone-900'

const ERRORS: Record<string, string> = {
  payment_pending: 'You already have a payment waiting for review.',
  reference_used: 'That transaction reference has already been used.',
  proof_reused: 'That screenshot has already been submitted.',
  unsupported_type: 'The proof must be a JPEG, PNG or WebP image.',
  file_too_large: 'The screenshot must be under 5 MB.',
  invalid_input: 'Check the reference (6–30 letters or digits) and try again.',
}

export default function Membership() {
  const { data: me } = useMeQuery()
  const { data: plans } = usePlansQuery()
  const { data: history } = useMyPaymentsQuery(undefined, { pollingInterval: 20000 })
  const [submit, { isLoading }] = useSubmitPaymentMutation()
  const [planId, setPlanId] = useState('monthly')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  if (!me || !plans) return <p className="text-stone-500">Loading…</p>

  const pending = history?.find((p) => p.status === 'pending')
  const latest = history?.[0]
  const plan = plans.plans.find((p) => p.id === planId) ?? plans.plans[0]!
  const { upiId, payeeName } = plans.payment

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(''); setSent(false)
    const form = e.currentTarget
    const f = new FormData(form)
    const proof = f.get('proof') as File
    if (!proof?.size) return setError('Add a screenshot of your payment.')
    if (proof.size > MAX_PROOF) return setError(ERRORS.file_too_large!)
    f.set('planId', planId)
    try {
      await submit(f).unwrap()
      form.reset()
      setSent(true)
    } catch (err: any) {
      setError(ERRORS[err?.data?.error] ?? 'Could not submit. Please try again.')
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="text-lg font-semibold">Membership</h2>
        {me.isMember ? (
          <p role="status" className="mt-1 text-emerald-800">
            {me.role === 'admin' ? 'Admin access (no expiry).' : `Active until ${dateOnly(me.membershipExpiresAt!)}.`}
          </p>
        ) : (
          <p className="mt-1 text-stone-600">Matching is free. A membership lets you message your connections.</p>
        )}
      </section>

      {latest?.status === 'rejected' && !pending && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-red-800">
          Your last payment wasn't approved{latest.reason ? `: ${latest.reason}` : '.'} You can submit it again.
        </p>
      )}

      {pending ? (
        <p role="status" className="rounded-md bg-amber-50 p-3 text-amber-900">
          Payment of {inr(pending.amountPaise)} (ref {pending.reference}) is under review. This page updates when it's approved.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border border-stone-200 bg-white p-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{me.isMember ? 'Extend your membership' : 'Choose a plan'}</legend>
            {plans.plans.map((p) => (
              <label key={p.id} className={`flex cursor-pointer items-center justify-between rounded-md border px-3 py-2 ${p.id === planId ? 'border-stone-900 bg-stone-50' : 'border-stone-300'}`}>
                <span className="flex items-center gap-2">
                  <input type="radio" name="plan" checked={p.id === planId} onChange={() => setPlanId(p.id)} />
                  {p.name}
                </span>
                <span className="font-medium">{inr(p.amountPaise)}</span>
              </label>
            ))}
          </fieldset>

          <div className="rounded-md bg-stone-50 p-3 text-sm">
            {upiId ? (
              <p>Pay <strong>{inr(plan.amountPaise)}</strong> to UPI ID <code className="select-all">{upiId}</code>{payeeName ? ` (${payeeName})` : ''}, then add the details below.</p>
            ) : (
              <p className="text-stone-600">Payment details haven't been set up yet. Please check back soon.</p>
            )}
          </div>

          <label className="flex flex-col gap-1 text-sm font-medium">Transaction reference (UTR)
            <input name="reference" required minLength={6} maxLength={30} pattern="[A-Za-z0-9]{6,30}" autoComplete="off" className={field} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">Payment screenshot
            <input name="proof" type="file" accept="image/jpeg,image/png,image/webp" required className={`${field} text-sm`} />
          </label>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          {sent && <p role="status" className="text-sm text-emerald-700">Submitted. We'll review it shortly.</p>}
          <button disabled={isLoading || !upiId} className="self-start rounded-md bg-stone-900 px-4 py-2 text-white disabled:opacity-50">
            {isLoading ? 'Uploading…' : 'Submit payment'}
          </button>
        </form>
      )}

      {!!history?.length && (
        <section>
          <h3 className="mb-2 text-sm font-medium text-stone-600">Payment history</h3>
          <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white text-sm">
            {history.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-4 py-2">
                <span>{inr(p.amountPaise)} · {dateTime(p.createdAt)}</span>
                <span className={p.status === 'approved' ? 'text-emerald-700' : p.status === 'rejected' ? 'text-red-700' : 'text-amber-700'}>
                  {p.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
