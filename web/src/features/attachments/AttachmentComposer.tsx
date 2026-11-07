import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAttachmentQuotaQuery, useSendAttachmentMutation } from './api'
import { formatDuration } from './MessageAttachment'

const MAX_BYTES = 5 * 1024 * 1024
const MAX_VOICE_MS = 120_000
const IMAGE_TYPES = 'image/jpeg,image/png,image/webp'
const AUDIO_TYPES = 'audio/webm,audio/ogg,audio/mp4,audio/mpeg,audio/wav'
const RECORDER_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']

type Problem = { text: string; membership?: boolean }

/** Maps whatever MediaRecorder reports (e.g. "audio/webm;codecs=opus") to a type and extension the server sniffs as audio. */
function serverAudioType(recorderMime: string) {
  const base = recorderMime.split(';')[0]!.trim().toLowerCase()
  if (base.endsWith('/ogg')) return { mime: 'audio/ogg', ext: 'ogg' }
  if (base.endsWith('/mp4')) return { mime: 'audio/mp4', ext: 'm4a' }
  return { mime: 'audio/webm', ext: 'webm' }
}

function describeError(err: any): Problem {
  const code = err?.data?.error
  if (err?.status === 402) return { text: 'Sending needs a membership.', membership: true }
  if (code === 'image_quota_exceeded') return { text: "You've reached today's limit of 20 photos in this chat. Try again later." }
  if (err?.status === 413) return { text: 'That file is too large (5 MB maximum).' }
  if (err?.status === 415) return { text: 'That file type is not supported. Use a JPEG, PNG or WebP photo, or a standard audio recording.' }
  if (err?.status === 403) return { text: code === 'blocked' ? "You can't message this person." : "You can't send messages in this chat." }
  if (err?.status === 404) return { text: 'This conversation is no longer available.' }
  if (err?.status === 400 && err?.data?.field === 'durationMs') return { text: 'The voice message length is invalid (1 second to 2 minutes).' }
  return { text: 'Could not send. Check your connection and try again.' }
}

/** Reads an audio file's length in milliseconds, or null when the browser can't decode it. */
function audioDuration(file: Blob) {
  return new Promise<number | null>((resolve) => {
    const url = URL.createObjectURL(file)
    const el = new Audio()
    const done = (v: number | null) => { URL.revokeObjectURL(url); resolve(v) }
    el.preload = 'metadata'
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : null)
    el.onerror = () => done(null)
    el.src = url
  })
}

const Icon = ({ children }: { children: ReactNode }) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
)
const buttonClass = 'inline-flex h-10 w-10 items-center justify-center rounded-full border border-stone-300 bg-white text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50'

export default function AttachmentComposer({ connectionId }: { connectionId: string }) {
  const [sendAttachment, { isLoading: uploading }] = useSendAttachmentMutation()
  const { data: quota } = useAttachmentQuotaQuery(connectionId)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [recording, setRecording] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const photoInput = useRef<HTMLInputElement>(null)
  const audioInput = useRef<HTMLInputElement>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const timer = useRef<ReturnType<typeof setInterval>>(undefined)
  const startedAt = useRef(0)
  const discard = useRef(false)

  const releaseMic = () => {
    clearInterval(timer.current)
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
  }
  useEffect(() => () => {
    discard.current = true
    if (recorder.current?.state === 'recording') recorder.current.stop()
    releaseMic()
  }, [])

  async function submit(file: Blob, filename: string, durationMs?: number) {
    setProblem(null)
    try { await sendAttachment({ connectionId, file, filename, durationMs }).unwrap() }
    catch (err) { setProblem(describeError(err)) }
  }

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.type && !IMAGE_TYPES.split(',').includes(file.type)) return setProblem({ text: 'Choose a JPEG, PNG or WebP photo.' })
    if (file.size > MAX_BYTES) return setProblem({ text: 'That photo is too large (5 MB maximum).' })
    await submit(file, file.name)
  }

  async function onAudioFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_BYTES) return setProblem({ text: 'That recording is too large (5 MB maximum).' })
    const ms = await audioDuration(file)
    if (ms === null || ms < 1) return setProblem({ text: "Couldn't read that audio file. Try a different one." })
    if (ms > MAX_VOICE_MS) return setProblem({ text: 'Voice messages can be at most 2 minutes long.' })
    await submit(file, file.name, ms)
  }

  async function startRecording() {
    setProblem(null)
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      audioInput.current?.click() // no recording support: let the user pick an audio file instead
      return
    }
    let media: MediaStream
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err: any) {
      setProblem({
        text: err?.name === 'NotFoundError' ? 'No microphone was found.'
          : err?.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in your browser settings to record.'
          : 'The microphone could not be started.',
      })
      return
    }
    const mimeType = RECORDER_TYPES.find((t) => MediaRecorder.isTypeSupported(t))
    let rec: MediaRecorder
    try {
      rec = new MediaRecorder(media, mimeType ? { mimeType } : undefined)
    } catch {
      media.getTracks().forEach((t) => t.stop())
      setProblem({ text: 'Recording is not supported in this browser.' })
      return
    }
    const chunks: Blob[] = []
    discard.current = false
    rec.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data) }
    rec.onstop = () => {
      const durationMs = Math.min(Math.max(Math.round(performance.now() - startedAt.current), 1), MAX_VOICE_MS)
      releaseMic()
      recorder.current = null
      setRecording(false)
      if (discard.current) return
      const { mime, ext } = serverAudioType(rec.mimeType || mimeType || '')
      void submit(new Blob(chunks, { type: mime }), `voice.${ext}`, durationMs)
    }
    stream.current = media
    recorder.current = rec
    startedAt.current = performance.now()
    setElapsedMs(0)
    setRecording(true)
    rec.start()
    timer.current = setInterval(() => {
      const ms = performance.now() - startedAt.current
      setElapsedMs(Math.min(ms, MAX_VOICE_MS))
      if (ms >= MAX_VOICE_MS && rec.state === 'recording') rec.stop()
    }, 250)
  }

  const stopRecording = (send: boolean) => {
    discard.current = !send
    if (recorder.current?.state === 'recording') recorder.current.stop()
  }

  const outOfPhotos = quota?.imagesRemaining === 0

  if (recording) {
    return (
      <div className="mt-2 flex items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2" role="group" aria-label="Recording voice message">
        <span aria-hidden="true" className="h-3 w-3 animate-pulse rounded-full bg-red-600" />
        <span role="timer" aria-label="Recording time" className="font-mono text-sm tabular-nums">
          {formatDuration(elapsedMs)} / {formatDuration(MAX_VOICE_MS)}
        </span>
        <span className="flex-1" />
        <button type="button" onClick={() => stopRecording(false)} className="rounded-md border border-stone-300 bg-white px-3 py-1 text-sm">Cancel</button>
        <button type="button" onClick={() => stopRecording(true)} className="rounded-md bg-stone-900 px-3 py-1 text-sm text-white">Send</button>
      </div>
    )
  }

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <button type="button" className={buttonClass} aria-label="Send photo" title={outOfPhotos ? 'Daily photo limit reached' : 'Send photo'}
          disabled={uploading || outOfPhotos} onClick={() => photoInput.current?.click()}>
          <Icon>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <circle cx="9" cy="10" r="1.5" />
            <path d="m21 16-5-5-8 8" />
          </Icon>
        </button>
        <button type="button" className={buttonClass} aria-label="Record voice message" title="Record voice message"
          disabled={uploading} onClick={() => void startRecording()}>
          <Icon>
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </Icon>
        </button>
        <input ref={photoInput} type="file" accept={IMAGE_TYPES} hidden aria-hidden="true" tabIndex={-1} onChange={(e) => void onPhoto(e)} />
        <input ref={audioInput} type="file" accept={AUDIO_TYPES} hidden aria-hidden="true" tabIndex={-1} onChange={(e) => void onAudioFile(e)} />
        {uploading && <span role="status" className="text-sm text-stone-500">Sending…</span>}
        {!uploading && quota && quota.imagesRemaining <= 5 && (
          <span role="status" className="text-sm text-stone-500">
            {outOfPhotos ? 'Photo limit reached for today.' : `${quota.imagesRemaining} photo${quota.imagesRemaining === 1 ? '' : 's'} left today.`}
          </span>
        )}
      </div>
      {problem && (
        <p role="alert" className={`mt-2 text-sm ${problem.membership ? 'rounded-md bg-amber-50 p-3 text-amber-900' : 'text-red-600'}`}>
          {problem.text} {problem.membership && <Link className="underline" to="/membership">See plans</Link>}
        </p>
      )}
    </div>
  )
}
