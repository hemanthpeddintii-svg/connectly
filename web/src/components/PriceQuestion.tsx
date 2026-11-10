import { useState } from 'react'
import { useMeQuery } from '../api'
import { usePriceInterestMutation, type PriceAnswer } from '../features/beta/api'
import { card, eyebrow } from '../ui'

const options: Array<{ a: PriceAnswer; label: string }> = [{ a: 'yes', label: 'Yes' }, { a: 'maybe', label: 'Maybe' }, { a: 'no', label: 'No' }]

/** One-time question for men during the beta. Disappears once answered. */
export default function PriceQuestion() {
  const { data: me } = useMeQuery()
  const [send, { isLoading, isError }] = usePriceInterestMutation()
  const [thanks, setThanks] = useState(false)
  if (thanks) return <p role="status" className={`${card} text-[15px]`}>Thanks, that helps us a lot.</p>
  if (!me || me.gender !== 'man' || me.priceInterest) return null
  return (
    <section aria-labelledby="price-q" className={`${card} flex flex-col gap-3`}>
      <span className={eyebrow}>One quick question</span>
      <h2 id="price-q" className="font-display text-lg font-semibold">Would you pay ₹499 for 10 requests?</h2>
      <p className="text-[13px] text-slate">Requests are free during the beta. Nothing is charged. We only want to know what is fair.</p>
      <div className="flex gap-2">
        {options.map((o) => (
          <button key={o.a} type="button" disabled={isLoading}
            onClick={async () => { try { await send({ answer: o.a }).unwrap(); setThanks(true) } catch { /* shown below */ } }}
            className="h-11 flex-1 rounded-full bg-mist text-[15px] font-semibold disabled:opacity-50">{o.label}</button>
        ))}
      </div>
      {isError && <p role="alert" className="text-sm text-ember-deep">Couldn't save that. Please try again.</p>}
    </section>
  )
}
