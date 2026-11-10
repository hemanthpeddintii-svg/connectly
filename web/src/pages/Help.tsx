import { useState } from 'react'
import PageHeader from '../components/PageHeader'
import SupportContact from '../components/SupportContact'
import { ChevronIcon } from '../components/icons'

const faqs = [
  ['How do requests work?', 'A request is a short note to a member. She can accept, or say not now. Each one uses 1 request from your balance, and requests do not expire.'],
  ['What if my payment is rejected?', 'We tell you the reason. You can submit the details again, or contact support.'],
  ['How do I take a break?', 'Turn on quiet mode in Settings. You are hidden from the community and your chats carry on.'],
  ['Who sees my selfie and voice clip?', 'Only our review team. They are never shown to members. Both files are deleted once the review is decided.'],
]

export default function Help() {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <div className="flex flex-col gap-4 pb-4">
      <PageHeader title="Help and support" back="/settings" backLabel="Back to settings" />
      <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-ember-deep">Common questions</h2>
      <ul className="flex flex-col gap-2">
        {faqs.map(([q, a], i) => (
          <li key={q} className="rounded-3xl bg-white">
            <h3>
              <button type="button" aria-expanded={open === i} aria-controls={`faq-${i}`} onClick={() => setOpen(open === i ? null : i)}
                className="flex min-h-14 w-full items-center justify-between gap-3 px-5 text-left text-[15px] font-semibold">
                {q}<span aria-hidden="true" className={open === i ? 'rotate-90' : ''}><ChevronIcon size={20} /></span>
              </button>
            </h3>
            <p id={`faq-${i}`} hidden={open !== i} className="px-5 pb-4 text-[15px] text-slate">{a}</p>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 rounded-3xl bg-white p-5">
        <h2 className="font-display text-lg font-semibold">Still stuck?</h2>
        <p className="text-[15px] text-slate">Tell us what happened and a real person on our team will read it.</p>
        <SupportContact />
      </div>
    </div>
  )
}
