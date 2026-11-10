import { Link, useParams } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { ChevronIcon } from '../components/icons'
import SupportContact from '../components/SupportContact'
import { DRAFT_NOTE, LEGAL_DOCS } from '../features/onboarding/docs'

export default function Legal() {
  const { doc } = useParams()
  const d = LEGAL_DOCS.find((x) => x.slug === doc)
  if (doc && d) {
    return (
      <div className="flex flex-col gap-4 pb-4">
        <PageHeader title={d.title} back="/legal" backLabel="Back to terms and privacy" />
        <p role="note" className="rounded-2xl bg-mist p-3 text-[13px] font-semibold text-ember-deep">{DRAFT_NOTE}</p>
        {d.sections.map((s) => (
          <section key={s.h} className="flex flex-col gap-1"><h2 className="text-base font-semibold">{s.h}</h2><p className="text-[15px] text-slate">{s.p}</p></section>
        ))}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4 pb-4">
      <PageHeader title="Terms, privacy and refunds" back="/settings" backLabel="Back to settings" />
      <section className="rounded-3xl bg-white p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-ember-deep">In short</h2>
        <ul className="mt-2 list-disc pl-5 text-[15px]">
          <li>Requests are non-refundable once sent.</li>
          <li>We never show your selfie or voice clip to members.</li>
          <li>Both files are deleted once our team has decided your review.</li>
        </ul>
        <p className="mt-2 text-[13px] text-slate">This is a plain summary. The full documents below are what applies.</p>
      </section>
      <p role="note" className="text-[13px] font-semibold text-ember-deep">{DRAFT_NOTE}</p>
      <ul className="flex flex-col gap-2">
        {LEGAL_DOCS.map((x) => (
          <li key={x.slug}>
            <Link to={`/legal/${x.slug}`} className="flex min-h-14 items-center justify-between rounded-[22px] bg-white px-5">
              <span><b className="block text-[15px]">{x.title}</b><span className="text-[13px] text-slate">{x.blurb} Updated [DATE]</span></span>
              <ChevronIcon size={20} />
            </Link>
          </li>
        ))}
      </ul>
      <SupportContact />
    </div>
  )
}
