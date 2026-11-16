import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useConnectionsQuery, useEditMessageMutation, useMarkReadMutation, useMessagesQuery, useSendMessageMutation, type Message } from '../api'
import MessageAttachment from '../features/attachments/MessageAttachment'
import AttachmentComposer from '../features/attachments/AttachmentComposer'
import SafetyMenu from '../features/safety/SafetyMenu'
import CloseChat, { ClosedNote } from '../components/CloseChat'
import Monogram from '../components/Monogram'
import RealPerson from '../components/Badge'
import { BackIcon, CloseIcon, EditIcon, ReplyIcon, SendIcon } from '../components/icons'
import { field } from '../ui'
import { motion } from 'motion/react'
import { ease, useStill } from '../components/motion'

/** Text can be edited for this long after it is sent. The server enforces the same limit. */
const EDIT_WINDOW_MS = 15 * 60_000

const actionBtn = 'inline-flex h-8 items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 text-xs font-medium text-slate transition hover:border-ink hover:text-ink'

/** The small quote shown above a reply, so you can see what it answers. Tap it to jump to the original. */
function Quote({ reply, mine }: { reply: NonNullable<Message['replyTo']>; mine: boolean }) {
  return (
    <button type="button" aria-label={`In reply to: ${reply.preview}`}
      onClick={() => document.getElementById(`msg-${reply.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })}
      className={`mb-1.5 block w-full rounded-xl border-l-[3px] px-2.5 py-1.5 text-left text-[13px] leading-snug ${mine ? 'border-paper/60 bg-paper/10 text-paper/85' : 'border-ink/40 bg-mist text-slate'}`}>
      <span className="block text-[11px] font-semibold uppercase tracking-wide opacity-80">{reply.mine ? 'You' : 'Them'}</span>
      <span className="line-clamp-2 break-words">{reply.preview}</span>
    </button>
  )
}

/** A one-time reminder at the top of each chat. Dismissing it is remembered on this device only. */
function SafetyTip({ id }: { id: string }) {
  const key = `connectly.tip.${id}`
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(key) === '1' } catch { return false } })
  if (hidden) return null
  const close = () => { setHidden(true); try { localStorage.setItem(key, '1') } catch { /* storage blocked: it just shows again next time */ } }
  return (
    <div role="note" className="flex items-start gap-3 rounded-2xl border border-stone-200 bg-sage px-4 py-3 text-[13px] leading-snug text-slate">
      <p className="flex-1">Keep the chat here until you trust each other. Never send money. Meet first in a public place. <Link to="/safety" className="font-semibold text-ink underline underline-offset-2">Safety tips</Link></p>
      <button type="button" onClick={close} aria-label="Dismiss safety tip" className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-ink transition hover:bg-white/70"><CloseIcon size={14} /></button>
    </div>
  )
}

export default function Chat() {
  const { id = '' } = useParams()
  const { data, isLoading, isError } = useMessagesQuery(id)
  const { data: connections } = useConnectionsQuery()
  const [send, { isLoading: sending }] = useSendMessageMutation()
  const [edit, { isLoading: saving }] = useEditMessageMutation()
  const [text, setText] = useState('')
  // Which message the action buttons are open for, which one is being answered, and which one is being edited.
  const [selected, setSelected] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [editing, setEditing] = useState<Message | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const [sendError, setSendError] = useState('')
  const [markRead] = useMarkReadMutation()
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [data?.length])
  // Mark read on open and whenever new messages arrive while the chat is open.
  useEffect(() => { if (id && data) void markRead(id) }, [id, data?.length, markRead]) // eslint-disable-line react-hooks/exhaustive-deps
  const still = useStill()
  const conn = connections?.find((c) => c.id === id)
  const who = conn?.profile
  const closed = conn?.closed ?? null

  const startReply = (m: Message) => { setEditing(null); setReplyTo(m); setSelected(null); input.current?.focus() }
  const startEdit = (m: Message) => { setReplyTo(null); setEditing(m); setText(m.body); setSelected(null); input.current?.focus() }
  const cancelCompose = () => { setReplyTo(null); setEditing(null); setText('') }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const body = text.trim()
    if (!body) return
    setSendError('')
    if (editing) {
      if (body === editing.body) { cancelCompose(); return }
      try { await edit({ id, messageId: editing.id, body }).unwrap(); cancelCompose() }
      catch (err) {
        const code = (err as { data?: { error?: string } })?.data?.error
        setSendError(code === 'chat_closed' ? 'This chat has been closed.' : code === 'edit_window_closed' ? 'You can only edit a message for 15 minutes after sending it.'
          : code === 'blocked' ? "You can't message this person."
            : code === 'suspended' ? "Your account is suspended, so you can't edit messages right now."
              : "Couldn't save the change. Try again.")
      }
      return
    }
    const quoting = replyTo
    setText(''); setReplyTo(null)
    try { await send({ id, body, ...(quoting ? { replyToId: quoting.id } : {}) }).unwrap() }
    catch (err) {
      setText(body); setReplyTo(quoting)
      const code = (err as { data?: { error?: string } })?.data?.error
      setSendError(code === 'chat_closed' ? 'This chat has been closed.' : code === 'blocked' ? "You can't message this person."
        : code === 'suspended' ? "Your account is suspended, so you can't send messages right now."
          : "Didn't send. Try again?")
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
          <h1 className="truncate font-display text-lg">{who?.name ?? 'Chat'}</h1>
          {who && <RealPerson />}
        </div>
        {who && !closed && <CloseChat connectionId={id} />}
        {who && <SafetyMenu memberId={who.memberId} />}
      </div>
      <div role="log" aria-label="Messages" className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-4">
        <SafetyTip id={id} />
        {isLoading && <p role="status" className="text-slate">Loading…</p>}
        {data?.map((m) => {
          const canEdit = m.mine && m.kind === 'text' && Date.now() - m.createdAt < EDIT_WINDOW_MS
          const open = selected === m.id
          return (
            <motion.div key={m.id} id={`msg-${m.id}`} className={`flex flex-col gap-1.5 ${m.mine ? 'items-end' : 'items-start'}`}
              initial={still ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease }}>
              {m.kind === 'text' ? (
                <button type="button" aria-expanded={open} onClick={() => setSelected(open ? null : m.id)}
                  className={`max-w-[80%] cursor-pointer rounded-[20px] px-4 py-2.5 text-left leading-normal ${m.mine ? 'bg-ink text-paper' : 'border border-stone-200 bg-white'}`}>
                  {m.replyTo && <Quote reply={m.replyTo} mine={m.mine} />}
                  <span className="block whitespace-pre-wrap break-words">{m.body}</span>
                  {m.editedAt && <span className="mt-0.5 block text-[11px] opacity-60">edited</span>}
                </button>
              ) : (
                <div className="flex w-full flex-col gap-1.5">
                  {m.replyTo && <div className={m.mine ? 'ml-auto max-w-[80%]' : 'mr-auto max-w-[80%]'}><Quote reply={m.replyTo} mine={false} /></div>}
                  <MessageAttachment connectionId={id} message={m} />
                </div>
              )}
              {!closed && (open || m.kind !== 'text') && (
                <div className="flex gap-2">
                  <button type="button" onClick={() => startReply(m)} className={actionBtn}><ReplyIcon size={14} />Reply</button>
                  {canEdit && <button type="button" onClick={() => startEdit(m)} className={actionBtn}><EditIcon size={14} />Edit</button>}
                </div>
              )}
            </motion.div>
          )
        })}
        <div ref={end} />
      </div>
      <div className="flex-none border-t border-stone-200 bg-paper px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {sendError && <p role="alert" className="mb-2 text-sm text-ember-deep">{sendError}</p>}
        {(replyTo || editing) && (
          <div role="status" className="mb-2 flex items-center gap-3 rounded-2xl border border-stone-200 bg-white py-2 pl-4 pr-2">
            <span className="flex min-w-0 flex-1 flex-col text-[13px] leading-snug">
              <span className="font-semibold">{editing ? 'Editing your message' : replyTo?.mine ? 'Replying to yourself' : 'Replying'}</span>
              <span className="truncate text-slate">{(editing ?? replyTo)?.kind === 'voice' ? 'Voice message' : (editing ?? replyTo)?.body}</span>
            </span>
            <button type="button" onClick={cancelCompose} aria-label={editing ? 'Cancel editing' : 'Cancel reply'}
              className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-slate transition hover:bg-mist hover:text-ink"><CloseIcon size={16} /></button>
          </div>
        )}
        {closed ? <ClosedNote byMe={closed.byMe} kind={closed.kind} name={who?.name} /> : (
        <AttachmentComposer connectionId={id}>
          <form onSubmit={submit} className="flex flex-1 items-center gap-2">
            <label className="sr-only" htmlFor="msg">Message</label>
            <input id="msg" ref={input} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Write a message" className={`${field} !rounded-full !bg-white !py-2.5`} />
            <button disabled={sending || saving || !text.trim()} aria-label={editing ? 'Save change' : 'Send'}
              className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-ink text-paper transition active:scale-95 disabled:opacity-40"><SendIcon size={22} /></button>
          </form>
        </AttachmentComposer>
        )}
      </div>
    </div>
  )
}
