import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useSendAttachmentMutation } from './api'
import { formatDuration } from './MessageAttachment'
import { MicIcon } from '../../components/icons'

const MAX_BYTES = 5 * 1024 * 1024
const MAX_VOICE_MS = 120_000
const AUDIO_TYPES = 'audio/webm,audio/ogg,audio/mp4,audio/mpeg,audio/wav'
const RECORDER_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']

/** Maps whatever MediaRecorder reports (e.g. "audio/webm;codecs=opus") to a type and extension the server sniffs as audio. */
function serverAudioType(recorderMime: string) {
  const base = recorderMime.split(';')[0]!.trim().toLowerCase()
  if (base.endsWith('/ogg')) return { mime: 'audio/ogg', ext: 'ogg' }
  if (base.endsWith('/mp4')) return { mime: 'audio/mp4', ext: 'm4a' }
  return { mime: 'audio/webm', ext: 'webm' }
}

function describeError(err: unknown): string {
  const e = err as { status?: number; data?: { error?: string; field?: string } }
  if (e?.status === 413) return 'That file is too large (5 MB maximum).'
  if (e?.status === 415) return 'That file type is not supported. Use a standard audio recording.'
  if (e?.status === 403) return e.data?.error === 'blocked' ? "You can't message this person." : "You can't send messages in this chat."
  if (e?.status === 404) return 'This conversation is no longer available.'
  if (e?.status === 400 && e.data?.field === 'durationMs') return 'The voice message length is invalid (1 second to 2 minutes).'
  return 'Could not send. Check your connection and try again.'
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

/** The voice-message control, beside the text box (children). While recording it takes over the whole row. */
export default function AttachmentComposer({ connectionId, children }: { connectionId: string; children: ReactNode }) {
  const [sendAttachment, { isLoading: uploading }] = useSendAttachmentMutation()
  const [problem, setProblem] = useState('')
  const [recording, setRecording] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
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
    setProblem('')
    try { await sendAttachment({ connectionId, file, filename, durationMs }).unwrap() }
    catch (err) { setProblem(describeError(err)) }
  }

  async function onAudioFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_BYTES) return setProblem('That recording is too large (5 MB maximum).')
    const ms = await audioDuration(file)
    if (ms === null || ms < 1) return setProblem("Couldn't read that audio file. Try a different one.")
    if (ms > MAX_VOICE_MS) return setProblem('Voice messages can be at most 2 minutes long.')
    await submit(file, file.name, ms)
  }

  async function startRecording() {
    setProblem('')
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      audioInput.current?.click() // no recording support: let the user pick an audio file instead
      return
    }
    let media: MediaStream
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err: any) {
      setProblem(
        err?.name === 'NotFoundError' ? 'No microphone was found.'
          : err?.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in your browser settings to record.'
          : 'The microphone could not be started.',
      )
      return
    }
    const mimeType = RECORDER_TYPES.find((t) => MediaRecorder.isTypeSupported(t))
    let rec: MediaRecorder
    try {
      rec = new MediaRecorder(media, mimeType ? { mimeType } : undefined)
    } catch {
      media.getTracks().forEach((t) => t.stop())
      setProblem('Recording is not supported in this browser.')
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

  if (recording) {
    return (
      <div className="flex min-h-12 items-center gap-3 rounded-full bg-mist px-4 py-1.5" role="group" aria-label="Recording voice message">
        <span aria-hidden="true" className="h-3 w-3 animate-pulse rounded-full bg-ember motion-reduce:animate-none" />
        <span role="timer" aria-label="Recording time" className="font-mono text-sm tabular-nums">
          {formatDuration(elapsedMs)} / {formatDuration(MAX_VOICE_MS)}
        </span>
        <span className="flex-1" />
        <button type="button" onClick={() => stopRecording(false)} className="h-11 rounded-full px-3 text-sm font-semibold">Cancel</button>
        <button type="button" onClick={() => stopRecording(true)} className="h-11 rounded-full bg-ember px-4 text-sm font-semibold text-ink">Send</button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Record a voice message" title="Record a voice message"
          disabled={uploading} onClick={() => void startRecording()}
          className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-mist text-ink disabled:cursor-not-allowed disabled:opacity-50">
          <MicIcon size={22} />
        </button>
        <input ref={audioInput} type="file" accept={AUDIO_TYPES} hidden aria-hidden="true" tabIndex={-1} onChange={(e) => void onAudioFile(e)} />
        {children}
      </div>
      {uploading && <span role="status" className="text-sm text-slate">Sending voice message…</span>}
      {problem && <p role="alert" className="text-sm text-ember-deep">{problem}</p>}
    </div>
  )
}
