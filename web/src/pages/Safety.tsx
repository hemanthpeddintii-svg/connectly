import { useSelector } from 'react-redux'
import type { RootState } from '../store'
import PageHeader from '../components/PageHeader'
import SupportContact from '../components/SupportContact'
import GrievanceContact from '../components/GrievanceContact'
import { PageFade, Reveal } from '../components/motion'
import { card, eyebrow } from '../ui'

const sections: Array<{ h: string; items: string[] }> = [
  {
    h: 'What "verified" means',
    items: [
      'Before a member can use the community, a person on our team looks at a selfie and listens to a short voice clip, to check that a real person is behind the profile.',
      'This is not a background check. We do not check identity documents, police records, jobs, or anything a member says about themselves.',
      'Verification does not guarantee who someone is or how they will behave. Please use your own judgement, always.',
    ],
  },
  {
    h: 'Before you share anything',
    items: [
      'Keep the conversation here until you trust each other. Do not share your phone number, address, workplace or financial details early.',
      'Never send money, gift cards or codes to anyone you meet here, whatever the reason. Anyone who asks should be blocked and reported.',
      'You can block anyone at any time. They are not told.',
    ],
  },
  {
    h: 'If you decide to meet',
    items: [
      'Meet in a public place, during the day, for the first time.',
      'Tell a friend or family member where you are going and who you are meeting.',
      'Arrange your own way there and back. Do not accept a lift from someone you have just met.',
      'If anything feels wrong, leave. You do not owe anyone an explanation.',
    ],
  },
  {
    h: 'If something goes wrong',
    items: [
      'Block the member, then report them from their card or from the chat. A person on our team reads every report.',
      'Members must be 18 or over. If someone seems to be under 18, report them as "Appears underage". We treat these reports as urgent.',
      'In an emergency call 112. For online fraud or harassment in India, call 1930 or report at cybercrime.gov.in. The women helpline is 181.',
    ],
  },
]

/** A plain-language safety page. Public, so people can read it before they join. */
export default function Safety() {
  const token = useSelector((s: RootState) => s.auth.token)
  return (
    <PageFade className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 pb-16 pt-4">
      <PageHeader title="Staying safe" back={token ? '/settings' : '/'} backLabel={token ? 'Back to settings' : 'Back to the home page'} />
      <p className="text-[17px] leading-relaxed text-slate">We check every member, and we act on reports. Staying safe is still partly up to you, so here is what we recommend.</p>
      {sections.map((s) => (
        <Reveal key={s.h} className={`${card} flex flex-col gap-3`}>
          <h2 className="font-display text-[24px] leading-tight">{s.h}</h2>
          <ul className="flex flex-col gap-2.5 text-[15px] leading-relaxed">
            {s.items.map((i) => <li key={i} className="flex gap-3"><span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 flex-none rounded-full bg-ember" />{i}</li>)}
          </ul>
        </Reveal>
      ))}
      <Reveal className={`${card} flex flex-col gap-2 bg-mist`}>
        <p className={eyebrow}>Need to complain?</p>
        <p className="text-[15px] leading-relaxed text-slate">Write to us and a real person will read it. You can also complain to our grievance officer.</p>
        <SupportContact />
        <GrievanceContact className="text-slate" />
      </Reveal>
    </PageFade>
  )
}
