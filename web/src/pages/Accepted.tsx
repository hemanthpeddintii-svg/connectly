import { Link, useLocation, useParams } from 'react-router-dom'
import { useConnectionsQuery } from '../api'
import Monogram from '../components/Monogram'
import { motion } from 'motion/react'
import { ease, useStill } from '../components/motion'

/** "Come in": shown right after a woman accepts. Full screen, dark, the dot steps inside the door. */
export default function Accepted() {
  const { connectionId = '' } = useParams()
  const state = useLocation().state as { name?: string; note?: string } | null
  const stateName = state?.name
  const note = state?.note?.trim()
  const { data } = useConnectionsQuery(undefined, { skip: !!stateName })
  const still = useStill()
  const rise = (delay: number) => (still ? {} : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.6, ease, delay } })
  const name = stateName ?? data?.find((c) => c.id === connectionId)?.profile.name ?? 'This member'
  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center overflow-y-auto bg-ink px-7 pb-10 pt-16 text-paper">
      <div className="flex w-full max-w-md flex-1 flex-col items-center justify-center gap-7">
        <svg role="img" aria-label="The door opens and the dot steps inside" viewBox="0 0 256 256" width="190" height="190">
          <path fill="var(--color-paper)" d="M36,220V128A92,92 0 0 1 220,128V220H176V128A48,48 0 0 0 80,128V220Z" />
          <circle className="come-in" fill="var(--color-ember)" cx="128" cy="182" r="22" />
        </svg>
        <motion.div {...rise(0.5)} className="flex flex-col items-center gap-3 text-center">
          <h1 className="font-display text-[48px] leading-none">Come in.</h1>
          <p className="max-w-[290px] text-[17px] leading-relaxed text-fog">You accepted {name}'s request. Say hello while it's fresh.</p>
          {note && (
            <figure className="mt-1 max-w-[310px] rounded-2xl border border-[#3A5A62] px-4 py-3 text-left">
              <figcaption className="text-[11px] font-semibold uppercase tracking-wide text-fog">What {name} wrote</figcaption>
              <blockquote className="mt-1 line-clamp-4 text-[15px] leading-snug text-paper">{note}</blockquote>
            </figure>
          )}
        </motion.div>
        <motion.div {...rise(0.7)}><Monogram name={name} size={76} tone="dark" /></motion.div>
      </div>
      <motion.div {...rise(0.85)} className="flex w-full max-w-md flex-none flex-col gap-3">
        <Link to={`/connections/${connectionId}`} className="flex h-[54px] items-center justify-center rounded-full bg-ember text-[17px] font-semibold text-ink transition hover:brightness-95 focus-visible:outline-paper">Say hello</Link>
        <Link to="/requests" className="flex h-12 items-center justify-center rounded-full border border-[#3A5A62] text-base font-medium text-paper transition hover:border-fog focus-visible:outline-paper">Back to requests</Link>
      </motion.div>
    </div>
  )
}
