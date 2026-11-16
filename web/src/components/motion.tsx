import type { ReactNode } from 'react'
import { motion, useReducedMotion, type Variants } from 'motion/react'

/** The one easing curve used everywhere: quick start, long soft landing. */
export const ease = [0.22, 1, 0.36, 1] as const

/** True when the visitor asked for less motion. Every animation here checks it and falls back to a still page. */
export function useStill() {
  return !!useReducedMotion()
}

/** A screen's content settles in: a short fade with a small rise. Re-keyed per route by the caller. */
export function PageFade({ children, className = '' }: { children: ReactNode; className?: string }) {
  const still = useStill()
  if (still) return <div className={className}>{children}</div>
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.42, ease }}>
      {children}
    </motion.div>
  )
}

/** Fades and lifts a block the first time it scrolls into view. */
export function Reveal({ children, className = '', delay = 0, y = 22 }: { children: ReactNode; className?: string; delay?: number; y?: number }) {
  const still = useStill()
  if (still) return <div className={className}>{children}</div>
  return (
    <motion.div className={className} initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 'some', margin: '0px 0px -8% 0px' }} transition={{ duration: 0.7, ease, delay }}>
      {children}
    </motion.div>
  )
}

const listVariants: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.04 } } }
const itemVariants: Variants = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease } } }

/** A list whose children rise in one after another. Use <StaggerItem> for each child. */
export function Stagger({ children, className = '', as = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'ul' | 'ol' }) {
  const still = useStill()
  const Tag = (motion as unknown as Record<string, typeof motion.div>)[as]
  if (still) { const Plain = as; return <Plain className={className}>{children}</Plain> }
  return <Tag className={className} variants={listVariants} initial="hidden" whileInView="show" viewport={{ once: true, amount: 'some', margin: '0px 0px -8% 0px' }}>{children}</Tag>
}

export function StaggerItem({ children, className = '', as = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'li' }) {
  const still = useStill()
  const Tag = (motion as unknown as Record<string, typeof motion.div>)[as]
  if (still) { const Plain = as; return <Plain className={className}>{children}</Plain> }
  return <Tag className={className} variants={itemVariants}>{children}</Tag>
}
