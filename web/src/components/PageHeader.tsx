import { Link } from 'react-router-dom'
import { BackIcon } from './icons'

/** A back arrow (a real link, 44px target) beside the page title. */
export default function PageHeader({ title, back, backLabel }: { title: string; back: string; backLabel: string }) {
  return (
    <div className="-ml-3 mb-2 flex h-14 items-center gap-1.5">
      <Link to={back} aria-label={backLabel} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-mist">
        <BackIcon />
      </Link>
      <h1 className="font-display text-[22px] font-semibold">{title}</h1>
    </div>
  )
}
