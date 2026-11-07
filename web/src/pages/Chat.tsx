import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMessagesQuery, useSendMessageMutation } from '../api'
import MessageAttachment from '../features/attachments/MessageAttachment'
import AttachmentComposer from '../features/attachments/AttachmentComposer'

export default function Chat() {
  const { id = '' } = useParams()
  const { data, isLoading, isError } = useMessagesQuery(id)
  const [send, { isLoading: sending }] = useSendMessageMutation()
  const [text, setText] = useState('')
  const [needsMembership, setNeedsMembership] = useState(false)
  const [sendError, setSendError] = useState('')
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [data?.length])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const body = text.trim()
    if (!body) return
    setText('')
    setNeedsMembership(false)
    setSendError('')
    try { await send({ id, body }).unwrap() }
    catch (err: any) {
      setText(body)
      if (err?.status === 402) setNeedsMembership(true)
      else if (err?.data?.error === 'blocked') setSendError("You can't message this person.")
      else setSendError('Message not sent. Try again.')
    }
  }

  if (isError) return <p>Conversation not found. <Link className="underline" to="/connections">Back</Link></p>
  return (
    <div className="flex h-[calc(100dvh-9rem)] flex-col">
      <Link to="/connections" className="mb-2 text-sm text-stone-500 underline">← Connections</Link>
      <div className="flex-1 space-y-2 overflow-y-auto rounded-xl border border-stone-200 bg-white p-3">
        {isLoading && <p className="text-stone-500">Loading…</p>}
        {data?.map((m) => (
          <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
            {m.kind === 'text' ? (
              <p className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 ${m.mine ? 'bg-stone-900 text-white' : 'bg-stone-100'}`}>{m.body}</p>
            ) : (
              <MessageAttachment connectionId={id} message={m} />
            )}
          </div>
        ))}
        <div ref={end} />
      </div>
      {needsMembership && (
        <p role="alert" className="mt-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          Sending messages needs a membership. <Link className="underline" to="/membership">See plans</Link>
        </p>
      )}
      {sendError && <p role="alert" className="mt-2 text-sm text-red-600">{sendError}</p>}
      <AttachmentComposer connectionId={id} />
      <form onSubmit={submit} className="mt-2 flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Write a message"
          className="flex-1 rounded-md border border-stone-300 bg-white px-3 py-2 outline-none focus:border-stone-900" />
        <button disabled={sending || !text.trim()} className="rounded-md bg-stone-900 px-4 py-2 text-white disabled:opacity-50">Send</button>
      </form>
    </div>
  )
}
