import { usePublicConfigQuery } from '../features/beta/api'

/** The named grievance officer members can complain to. Renders nothing until the owner sets a name or email in Admin settings. */
export default function GrievanceContact({ className = '' }: { className?: string }) {
  const { data } = usePublicConfigQuery()
  const name = data?.grievanceName?.trim() ?? ''
  const email = data?.grievanceEmail?.trim() ?? ''
  if (!name && !email) return null
  return (
    <p className={`text-sm ${className}`}>
      Grievance officer{name && <>: <b className="font-semibold">{name}</b></>}
      {email && <> · <a className="font-semibold underline underline-offset-2" href={`mailto:${email}`}>{email}</a></>}
    </p>
  )
}
