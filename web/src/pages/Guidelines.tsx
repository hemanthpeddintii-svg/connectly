import PageHeader from '../components/PageHeader'
import { card } from '../ui'
import { PageFade, Stagger, StaggerItem } from '../components/motion'

const items = [
  ['Be kind', 'Write to people the way you would like to be written to. Honest and gentle is always welcome.'],
  ['Respect a no', "Not now is a complete answer. Do not push, repeat or send a new request to change someone's mind."],
  ['Protect your details', 'Keep your phone number, address and workplace to yourself until you truly trust someone. Never send money.'],
  ['Meet safely', 'Meet in a public place, tell a friend where you are going, and plan your own way home.'],
  ['Report concerns', 'If something feels wrong, report the member or block them. They are never told who reported them.'],
]

export default function Guidelines() {
  return (
    <PageFade className="flex flex-col gap-6 pb-6">
      <PageHeader title="Community guidelines" back="/settings" backLabel="Back to settings" />
      <p className="text-[15px] text-slate">Five habits that keep this community safe.</p>
      <Stagger as="ul" className="flex flex-col gap-3">
        {items.map(([t, d]) => (
          <StaggerItem as="li" key={t} className={`${card} !p-5`}><h2 className="font-display text-xl">{t}</h2><p className="mt-1.5 text-[15px] leading-relaxed text-slate">{d}</p></StaggerItem>
        ))}
      </Stagger>
    </PageFade>
  )
}
