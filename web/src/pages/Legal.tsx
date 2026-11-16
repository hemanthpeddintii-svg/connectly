import { Link, useParams } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { ChevronIcon } from '../components/icons'
import SupportContact from '../components/SupportContact'
import { PageFade } from '../components/motion'
import { card, eyebrow } from '../ui'
import { DRAFT_NOTE, LEGAL_DOCS, LEGAL_UPDATED } from '../features/onboarding/docs'

export default function Legal() {
  const { doc } = useParams()
  const d = LEGAL_DOCS.find((x) => x.slug === doc)
  if (doc && d) {
    return (
      <PageFade className="flex flex-col gap-6 pb-8">
        <PageHeader title={d.title} back="/legal" backLabel="Back to terms and privacy" />
        <p role="note" className="max-w-[65ch] rounded-2xl border border-ember/40 bg-ember/10 p-4 text-[13px] font-semibold text-ember-deep">{DRAFT_NOTE}</p>
        <div className="flex max-w-[65ch] flex-col gap-7">
          {d.sections.map((s) => (
            <section key={s.h} className="flex flex-col gap-2"><h2 className="font-display text-2xl">{s.h}</h2><p className="text-base leading-[1.75] text-slate">{s.p}</p></section>
          ))}
        </div>
      </PageFade>
    )
  }
  return (
    <PageFade className="flex flex-col gap-6 pb-8">
      <PageHeader title="Terms, privacy and refunds" back="/settings" backLabel="Back to settings" />
      <section className={card}>
        <h2 className={eyebrow}>In short</h2>
        <ul className="mt-3 list-disc pl-5 text-[15px] leading-relaxed">
          <li>A request is used once she answers, and returned if nobody answers in 14 days.</li>
          <li>We never show your selfie or voice clip to members.</li>
          <li>Both files are deleted once our team has decided your review.</li>
        </ul>
        <p className="mt-3 text-[13px] text-slate">This is a plain summary. The full documents below are what applies.</p>
      </section>
      <p role="note" className="rounded-2xl border border-ember/40 bg-ember/10 p-4 text-[13px] font-semibold text-ember-deep">{DRAFT_NOTE}</p>
      <ul className="flex flex-col gap-2">
        {LEGAL_DOCS.map((x) => (
          <li key={x.slug}>
            <Link to={`/legal/${x.slug}`} className="flex min-h-14 items-center justify-between rounded-[22px] border border-stone-200 bg-white px-5 py-3 transition hover:border-ink">
              <span><b className="block text-[15px] font-medium">{x.title}</b><span className="text-[13px] text-slate">{x.blurb} Updated {LEGAL_UPDATED}</span></span>
              <ChevronIcon size={20} />
            </Link>
          </li>
        ))}
      </ul>
      <SupportContact />
    </PageFade>
  )
}
