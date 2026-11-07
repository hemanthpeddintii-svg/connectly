import { Link } from 'react-router-dom'
import { plural } from '../format'
import { ArchIcon } from './icons'

/** The request balance, linking to the packs page. */
export default function CreditsChip({ credits }: { credits: number }) {
  return (
    <Link to="/membership" aria-label={`${plural(credits, 'request')} left. Get more requests`}
      className="inline-flex h-11 items-center gap-2 rounded-full bg-mist px-4 text-sm font-semibold text-ink">
      <ArchIcon size={16} />{plural(credits, 'request')}
    </Link>
  )
}
