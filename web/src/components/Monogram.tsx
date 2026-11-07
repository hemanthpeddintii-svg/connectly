type Props = {
  name: string
  /** Width in pixels; the height follows the arch proportion. */
  size?: number
  tone?: 'light' | 'dark'
  className?: string
}

/** A member's stand-in for a photo: their initial inside an arch. The top radius is half the width. */
export default function Monogram({ name, size = 52, tone = 'light', className = '' }: Props) {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? '?'
  const radius = Math.round(size / 2)
  const bottom = Math.max(6, Math.round(size * 0.15))
  return (
    <span
      aria-hidden="true"
      className={`inline-flex flex-none items-end justify-center font-display font-semibold leading-none ${tone === 'dark' ? 'bg-[#1B3A42] text-paper' : 'bg-mist text-ink'} ${className}`}
      style={{
        width: size,
        height: Math.round(size * 1.22),
        borderRadius: `${radius}px ${radius}px ${bottom}px ${bottom}px`,
        fontSize: Math.round(size * 0.5),
        paddingBottom: Math.round(size * 0.2),
      }}
    >{initial}</span>
  )
}
