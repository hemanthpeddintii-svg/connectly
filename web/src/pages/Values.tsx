import { Link, useNavigate } from 'react-router-dom'
import { btnPrimary } from '../ui'
import { LogoMark } from '../components/icons'

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
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 py-8">
      <LogoMark size={44} />
      <div>
        <h1 className="font-display text-[28px] font-semibold leading-tight">Our community values</h1>
        <p className="mt-1 text-[15px] text-slate">Five promises every member makes, so everyone can feel at ease.</p>
      </div>
      <ol className="flex flex-col gap-3">
        {values.map(([t, d], i) => (
          <li key={t} className="flex items-start gap-4 rounded-3xl bg-white p-4">
            <span aria-hidden="true" className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-mist font-display font-semibold">{i + 1}</span>
            <span><b className="block text-base">{t}</b><span className="text-[15px] text-slate">{d}</span></span>
          </li>
        ))}
      </ol>
      <Link to="/legal/terms" className="text-sm font-semibold underline">Read the full terms</Link>
      <button type="button" onClick={() => nav(-1)} className={`${btnPrimary} mt-auto`}>Continue</button>
    </main>
  )
}
