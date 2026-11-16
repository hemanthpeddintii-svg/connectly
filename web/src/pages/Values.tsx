import { Link, useNavigate } from 'react-router-dom'
import { btnPrimary, card } from '../ui'
import { LogoMark } from '../components/icons'
import { PageFade, Stagger, StaggerItem } from '../components/motion'

const values = [
  ['Be kind', "Talk to people the way you'd like to be spoken to."],
  ['Be honest', "Say who you are and what you're looking for."],
  ['Respect a no', 'A "not now" is a full answer. Don\'t push for another.'],
  ['Keep it safe', 'Report anything that worries you. Block anyone, any time.'],
  ['One real you', 'One account, your own details, no one else\'s.'],
]

export default function Values() {
  const nav = useNavigate()
  return (
    <PageFade className="mx-auto flex min-h-dvh max-w-md flex-col gap-7 px-5 py-8">
      <main className="flex flex-1 flex-col gap-7">
        <LogoMark size={40} />
        <div>
          <h1 className="font-display text-[38px] leading-[1.05]">Our community values</h1>
          <p className="mt-3 text-[15px] text-slate">Five promises every member makes, so everyone can feel at ease.</p>
        </div>
        <Stagger as="ol" className="flex flex-col gap-3">
          {values.map(([t, d], i) => (
            <StaggerItem as="li" key={t} className={`${card} flex items-start gap-4 !p-5`}>
              <span aria-hidden="true" className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-mist font-display">{i + 1}</span>
              <span><b className="block text-base font-medium">{t}</b><span className="text-[15px] text-slate">{d}</span></span>
            </StaggerItem>
          ))}
        </Stagger>
        <Link to="/legal/terms" className="text-sm font-medium underline">Read the full terms</Link>
        <button type="button" onClick={() => nav(-1)} className={`${btnPrimary} mt-auto`}>Continue</button>
      </main>
    </PageFade>
  )
}
