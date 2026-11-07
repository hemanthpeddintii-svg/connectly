import type { Message } from '../../api'
import { useBlobUrl } from '../../useBlobUrl'

export const formatDuration = (ms: number) => {
  const total = Math.max(Math.round(ms / 1000), 0)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

const bubble = (mine: boolean) =>
  `${mine ? 'ml-auto bg-ink text-paper' : 'mr-auto bg-mist text-ink'} max-w-[80%] rounded-[20px]`

function VoiceBubble({ connectionId, message }: { connectionId: string; message: Message }) {
  const { url, failed } = useBlobUrl(`/connections/${connectionId}/messages/${message.id}/attachment`)
  const label = message.attachmentDurationMs === null ? '' : formatDuration(message.attachmentDurationMs)
  return (
    <div className={`${bubble(message.mine)} flex flex-col gap-1 px-3 py-2`}>
      <span className="text-xs opacity-80">Voice message{label && ` · ${label}`}</span>
      {failed && <span role="alert" className="text-sm">Voice message couldn't be loaded.</span>}
      {!failed && !url && <span role="status" className="text-sm opacity-80">Loading…</span>}
      {url && <audio controls preload="metadata" src={url} aria-label={`Voice message${label && `, ${label}`}`} className="h-10 w-56 max-w-full" />}
    </div>
  )
}

/** The bubble for a voice message; text messages are rendered by Chat itself. Chat is text and voice only. */
export default function MessageAttachment({ connectionId, message }: { connectionId: string; message: Message }) {
  if (message.kind === 'image') return <p className={`${bubble(message.mine)} px-3.5 py-2 text-sm`}>A photo that is no longer shown.</p>
  if (message.kind === 'voice') return <VoiceBubble connectionId={connectionId} message={message} />
  return null
}
