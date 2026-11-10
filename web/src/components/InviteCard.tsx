import { useState } from 'react'
import { useMyInviteQuery } from '../features/beta/api'
import { plural } from '../format'
import { btnSecondary, card } from '../ui'

export default function InviteCard() {
  const { data } = useMyInviteQuery()
  const [copied, setCopied] = useState(false)
  if (!data) return null
  const link = `${window.location.origin}/signup?invite=${encodeURIComponent(data.code)}`
  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* clipboard blocked */ }
  }
  return (
    <section aria-labelledby="invite-title" className={`${card} flex flex-col gap-3`}>
      <h2 id="invite-title" className="font-display text-lg font-semibold">Invite a friend</h2>
      <p className="text-[15px] text-slate">Know someone who would fit in? Share your link. Your code is <b className="select-all text-ink">{data.code}</b>.</p>
      <button type="button" onClick={copy} className={btnSecondary}>{copied ? 'Link copied' : 'Copy invite link'}</button>
      <p role="status" className="text-[13px] text-slate">{data.friendsBrought === 0 ? 'No friends have joined with your code yet.' : `${plural(data.friendsBrought, 'friend')} joined with your code.`}</p>
    </section>
  )
}
