import type { ReactNode } from 'react'

type IconProps = { size?: number; className?: string }

function Stroke({ size = 24, className, width = 2, children }: IconProps & { width?: number; children: ReactNode }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" className={className}>{children}</svg>
  )
}

/** The Connectly mark: the arch with the ember dot inside. */
export function LogoMark({ size = 30, className, door = 'var(--color-ink)' }: IconProps & { door?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 256 256" width={size} height={size} className={className}>
      <path fill={door} d="M36,220V128A92,92 0 0 1 220,128V220H176V128A48,48 0 0 0 80,128V220Z" />
      <circle fill="var(--color-ember)" cx="128" cy="182" r="22" />
    </svg>
  )
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <LogoMark size={30} />
      <span className="font-display text-xl font-semibold tracking-[0.01em]">connectly</span>
    </span>
  )
}

export const BackIcon = (p: IconProps) => <Stroke width={2.2} {...p}><path d="M15 5l-7 7 7 7" /></Stroke>
export const ChevronIcon = (p: IconProps) => <Stroke {...p}><path d="M9 5l7 7-7 7" /></Stroke>
export const CheckIcon = ({ size = 14, ...p }: IconProps) => <Stroke width={2.5} size={size} {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Stroke>
export const ClockIcon = ({ size = 16, ...p }: IconProps) => <Stroke size={size} {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Stroke>
export const CloseIcon = ({ size = 16, ...p }: IconProps) => <Stroke size={size} {...p}><path d="M6 6l12 12M18 6L6 18" /></Stroke>
export const InfoIcon = ({ size = 18, ...p }: IconProps) => <Stroke size={size} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Stroke>
export const MicIcon = (p: IconProps) => <Stroke {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></Stroke>
export const SendIcon = (p: IconProps) => <Stroke {...p}><path d="M4 12l16-8-6 16-3-7z" /></Stroke>
export const UploadIcon = (p: IconProps) => <Stroke {...p}><path d="M12 16V5M7.5 9.5L12 5l4.5 4.5M5 19h14" /></Stroke>
export const ArchIcon = (p: IconProps) => <Stroke {...p}><path d="M5 20V11a7 7 0 0 1 14 0v9" /><circle cx="12" cy="15" r="1.6" fill="currentColor" /></Stroke>
export const ChatIcon = (p: IconProps) => <Stroke {...p}><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4 3.5V17A2.5 2.5 0 0 1 4 14.5z" /></Stroke>
export const UserIcon = (p: IconProps) => <Stroke {...p}><circle cx="12" cy="8" r="4" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></Stroke>
export const InboxIcon = (p: IconProps) => <Stroke {...p}><path d="M4 13l2.5-7.5h11L20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><path d="M4 13h4.5a3.5 3.5 0 0 0 7 0H20" /></Stroke>
