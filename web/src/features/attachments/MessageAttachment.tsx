import { useEffect, useRef, useState } from 'react'
import type { Message } from '../../api'
import { useBlobUrl } from '../../useBlobUrl'

export const formatDuration = (ms: number) => {
  const total = Math.max(Math.round(ms / 1000), 0)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

const bubble = (mine: boolean) =>
  `${mine ? 'ml-auto bg-stone-900 text-white' : 'mr-auto bg-stone-100 text-stone-900'} max-w-[80%] rounded-2xl`

function ImageBubble({ connectionId, message }: { connectionId: string; message: Message }) {
  const { url, failed } = useBlobUrl(`/connections/${connectionId}/messages/${message.id}/attachment`)
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const alt = message.mine ? 'Photo you sent' : 'Photo sent to you'

  useEffect(() => {
    if (!open) return
    closeButton.current?.focus()
    // The close button is the only focusable control, so Tab stays on it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
      else if (e.key === 'Tab') e.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      opener.current?.focus()
    }
  }, [open])

  if (failed) return <p role="alert" className={`${bubble(message.mine)} px-3 py-2 text-sm`}>Photo couldn't be loaded.</p>
  if (!url) return <div role="status" aria-label="Loading photo" className={`${bubble(message.mine)} h-40 w-48 animate-pulse`} />
  return (
    <>
      <button ref={opener} type="button" onClick={() => setOpen(true)} aria-label={`${alt}. Open larger`}
        className={`${bubble(message.mine)} overflow-hidden p-1`}>
        <img src={url} alt={alt} className="max-h-64 max-w-full rounded-xl object-cover" />
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label={alt} onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <img src={url} alt={alt} onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full rounded-lg object-contain" />
          <button ref={closeButton} type="button" onClick={() => setOpen(false)} aria-label="Close photo"
            className="absolute right-4 top-4 rounded-full bg-white px-3 py-1 text-sm font-medium text-stone-900">Close</button>
        </div>
      )}
    </>
  )
}

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

/** The bubble for an image or voice message; text messages are rendered by Chat itself. */
export default function MessageAttachment({ connectionId, message }: { connectionId: string; message: Message }) {
  if (message.kind === 'image') return <ImageBubble connectionId={connectionId} message={message} />
  if (message.kind === 'voice') return <VoiceBubble connectionId={connectionId} message={message} />
  return null
}
