import { useState } from 'react'
import { useCloseChatMutation, type CloseKind } from '../api'
import Sheet from './Sheet'
import { btnOutline, btnPrimary } from '../ui'

const OPTIONS: { kind: CloseKind; title: string; body: string }[] = [
  { kind: 'offline', title: "We're taking this offline", body: 'You are moving on from the app together. The chat closes with a kind note.' },
  { kind: 'kind', title: "It isn't the right fit", body: 'A kind, private way to end it. No reason is needed or shown.' },
]

/** A "Close chat" button and sheet. Closing is final: the history stays readable, and neither of you can send more. */
export default function CloseChat({ connectionId }: { connectionId: string }) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<CloseKind>('offline')
  const [close, { isLoading, isError }] = useCloseChatMutation()
  async function confirm() {
    try { await close({ id: connectionId, kind }).unwrap(); setOpen(false) } catch { /* the error line below explains */ }
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center rounded-full px-3 text-[13px] font-medium text-slate transition hover:bg-mist hover:text-ink">Close chat</button>
      {open && (
        <Sheet title="Close this chat" onClose={() => setOpen(false)}>
          <p className="text-[15px] text-slate">Either of you can close a chat at any time. You can still read it afterwards, but neither of you can send more.</p>
          <div role="radiogroup" aria-label="Why are you closing it" className="flex flex-col gap-2">
            {OPTIONS.map((o) => (
              <button key={o.kind} type="button" role="radio" aria-checked={kind === o.kind} onClick={() => setKind(o.kind)}
                className={`flex flex-col gap-0.5 rounded-2xl border p-4 text-left transition ${kind === o.kind ? 'border-ink bg-mist' : 'border-stone-200 bg-white'}`}>
                <b className="font-semibold">{o.title}</b>
                <span className="text-[14px] text-slate">{o.body}</span>
              </button>
            ))}
          </div>
          {isError && <p role="alert" className="text-sm text-ember-deep">Couldn't close the chat. Try again.</p>}
          <button type="button" onClick={confirm} disabled={isLoading} className={btnPrimary}>{isLoading ? 'Closing…' : 'Close chat'}</button>
          <button type="button" onClick={() => setOpen(false)} className={btnOutline}>Keep it open</button>
        </Sheet>
      )}
    </>
  )
}

/** What each member sees at the bottom of a closed chat. */
export function ClosedNote({ byMe, kind, name }: { byMe: boolean; kind: CloseKind; name?: string }) {
  const text = byMe
    ? (kind === 'offline' ? 'You closed this chat. Wishing you both well.' : 'You closed this chat kindly.')
    : (kind === 'offline' ? `${name ?? 'They'} is taking this offline. This chat is closed. Wishing you both well.` : 'This chat has been closed. You can still read it.')
  return <p role="status" className="rounded-2xl bg-sage px-4 py-3 text-center text-[14px] text-slate">{text}</p>
}
