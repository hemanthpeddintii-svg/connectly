import { Link } from 'react-router-dom'
import { btnOutline, btnPrimary } from '../ui'
import { CheckIcon, LogoMark } from '../components/icons'

const promises = [
  ['Verified members.', 'Everyone is checked by our team.'],
  ['No photos.', 'You meet through who you are first.'],
  ['You choose who comes in.', 'Nothing starts without a yes.'],
]

export default function Welcome() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-between gap-8 px-5 py-8">
      <div className="flex flex-col gap-6">
        <LogoMark size={44} />
        <div className="flex flex-col gap-3 pt-6">
          <h1 className="font-display text-[34px] font-semibold leading-tight">A community that helps you get matched</h1>
          <p className="text-base text-slate">Come in, meet people who are glad to hear from you.</p>
        </div>
        <ul className="flex flex-col gap-3">
          {promises.map(([a, b]) => (
            <li key={a} className="flex items-start gap-3 text-[15px]">
              <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-mist text-verified"><CheckIcon size={12} /></span>
              <span><b>{a}</b> <span className="text-slate">{b}</span></span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-3">
        <Link to="/signup" className={btnPrimary}>Join the community</Link>
        <Link to="/login" className={btnOutline}>Log in</Link>
      </div>
    </main>
  )
}
