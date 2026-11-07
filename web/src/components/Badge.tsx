import { CheckIcon } from './icons'

/** The verified mark. Always an icon plus the words, never colour alone. */
export default function RealPerson({ variant = 'inline' }: { variant?: 'inline' | 'pill' }) {
  if (variant === 'pill') {
    return (
      <span className="inline-flex h-7 items-center gap-1.5 self-start rounded-full bg-mist px-2.5 text-xs font-semibold text-verified">
        <CheckIcon size={12} />Real person
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-verified">
      <CheckIcon size={12} />Real person
    </span>
  )
}
