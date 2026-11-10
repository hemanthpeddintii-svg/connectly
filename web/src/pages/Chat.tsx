import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useConnectionsQuery, useMarkReadMutation, useMessagesQuery, useSendMessageMutation } from '../api'
import MessageAttachment from '../features/attachments/MessageAttachment'
import AttachmentComposer from '../features/attachments/AttachmentComposer'
import SafetyMenu from '../features/safety/SafetyMenu'
import Monogram from '../components/Monogram'
import RealPerson from '../components/Badge'
import { BackIcon, SendIcon } from '../components/icons'
import { field } from '../ui'

export default function Chat() {
  const { id = '' } = useParams()
  const { data, isLoading, isError } = useMessagesQuery(id)
  const { data: connections } = useConnectionsQuery()
  const [send, { isLoading: sending }] = useSendMessageMutation()
  const [text, setText] = useState('')
  const [sendError, setSendError] = useState('')
  const [markRead] = useMarkReadMutation()
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [data?.length])
  // Mark read on open and whenever new messages arrive while the chat is open.
  useEffect(() => { if (id && data) void markRead(id) }, [id, data?.length, markRead]) // eslint-disable-line react-hooks/exhaustive-deps
  const who = connections?.find((c) => c.id === id)?.profile

  async function submit(e: FormEvent) {
    e.preventDefault()
    const body = text.trim()
    if (!body) return
    setText('')
    setSendError('')
    try { await send({ id, body }).unwrap() }
    catch (err) {
      setText(body)
      const code = (err as { data?: { error?: string } })?.data?.error
      setSendError(code === 'blocked' ? "You can't message this person."
        : code === 'suspended' ? "Your account is suspended, so you can't send messages right now."
          : 'Message not sent. Try again.')
    }
  }

  if (isError) {
    return <p role="alert" className="p-5 text-slate">Conversation not found. <Link className="font-semibold text-ink underline" to="/connections">Back to chats</Link></p>
  }
  return (
    <div className="flex h-dvh flex-col md:h-[calc(100dvh-4rem)]">
      <div className="flex h-16 flex-none items-center gap-2 border-b border-stone-200 px-3">
        <Link to="/connections" aria-label="Back to chats" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-mist"><BackIcon /></Link>
        {who && <Monogram name={who.name} size={36} />}
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate font-display text-base font-semibold">{who?.name ?? 'Chat'}</h1>
          {who && <RealPerson />}
        </div>
        {who && <SafetyMenu memberId={who.memberId} />}
      </div>
      <div role="log" aria-label="Messages" className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
        {isLoading && <p role="status" className="text-slate">Loading…</p>}
        {data?.map((m) => (
          <div key={m.id} className="flex">
            {m.kind === 'text' ? (
              <p className={`max-w-[80%] whitespace-pre-wrap break-words rounded-[20px] px-3.5 py-2 ${m.mine ? 'ml-auto bg-ink text-paper' : 'mr-auto bg-mist'}`}>{m.body}</p>
            ) : (
              <MessageAttachment connectionId={id} message={m} />
            )}
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="flex-none border-t border-stone-200 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {sendError && <p role="alert" className="mb-2 text-sm text-ember-deep">{sendError}</p>}
        <AttachmentComposer connectionId={id}>
          <form onSubmit={submit} className="flex flex-1 items-center gap-2">
            <label className="sr-only" htmlFor="msg">Message</label>
            <input id="msg" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Write a message" className={`${field} !rounded-full !py-2.5`} />
            <button disabled={sending || !text.trim()} aria-label="Send"
              className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-ember text-ink disabled:opacity-50"><SendIcon size={22} /></button>
          </form>
        </AttachmentComposer>
      </div>
    </div>
  )
}
