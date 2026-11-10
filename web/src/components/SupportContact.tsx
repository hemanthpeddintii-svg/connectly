import { usePublicConfigQuery } from '../features/beta/api'

/** Shows support email and WhatsApp from public-config. Renders nothing when neither is set. */
export default function SupportContact({ className = '' }: { className?: string }) {
  const { data } = usePublicConfigQuery()
  const email = data?.supportEmail?.trim() ?? ''
  const wa = data?.supportWhatsapp?.trim() ?? ''
  const digits = wa.replace(/\D/g, '')
  if (!email && !digits) return null
  return (
    <p className={`text-sm ${className}`}>
      {email && <>Need help? Email <a className="font-semibold underline" href={`mailto:${email}`}>{email}</a></>}
      {email && digits && <span aria-hidden="true"> · </span>}
      {digits && <>WhatsApp <a className="font-semibold underline" href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer">{wa}</a></>}
    </p>
  )
}
