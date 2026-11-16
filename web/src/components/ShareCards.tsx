import { useEffect, useMemo, useRef, useState } from 'react'
import { useMyInviteQuery } from '../features/beta/api'
import { BRAND_NAME } from '../brand'
import { btnPrimary, btnSecondary, card } from '../ui'

/**
 * Shareable cards made only from the member's OWN words. They never show a name, age, photo, other member or chat.
 * The image is drawn in the browser and shared or saved from there; nothing is uploaded.
 */
export type Trait = { label: string; value: number }
export type NoteStyle = { title: string; line: string; traits: Trait[] }

const WARM = /\b(love|like|enjoy|happy|glad|kind|friend|family|care|thanks|thank|smile|laugh|warm|sweet|hug|cozy|calm)\w*/gi
const CURIOUS = /\b(why|how|what|where|when|wonder|curious|learn|explore|discover|try|ask|new|read|travel|book)\w*/gi
const PLAYFUL = /(haha|lol|fun|joke|silly|play|meme|banter|tease|chai|coffee|snack|dance|game)|[!]/gi
const DEEP = /\b(believe|value|think|feel|honest|real|grow|dream|goal|meaning|family|future|listen|care)\w*/gi

const clamp = (n: number) => Math.max(8, Math.min(96, Math.round(n)))
const hits = (s: string, re: RegExp) => (s.match(re) ?? []).length

/** A light-hearted read on how someone writes. It is for fun and says nothing about whether anyone is a good match. */
export function noteStyle(bio: string): NoteStyle | null {
  const text = bio.trim()
  if (text.length < 20) return null
  const words = text.split(/\s+/).length
  const per = Math.max(words, 8)
  const warm = clamp(30 + (hits(text, WARM) / per) * 400)
  const curious = clamp(28 + ((hits(text, CURIOUS) + hits(text, /\?/g) * 2) / per) * 400)
  const playful = clamp(24 + (hits(text, PLAYFUL) / per) * 450)
  const deep = clamp(26 + (hits(text, DEEP) / per) * 380 + Math.min(words, 60) / 3)
  const traits: Trait[] = [
    { label: 'Warm', value: warm }, { label: 'Curious', value: curious },
    { label: 'Playful', value: playful }, { label: 'Thoughtful', value: deep },
  ]
  const top = [...traits].sort((a, b) => b.value - a.value)
  const names: Record<string, string> = {
    Warm: 'Warm-hearted', Curious: 'Curious', Playful: 'Playful', Thoughtful: 'Thoughtful',
  }
  const second: Record<string, string> = {
    Warm: 'soul', Curious: 'explorer', Playful: 'spark', Thoughtful: 'listener',
  }
  const title = `${names[top[0].label]} ${second[top[1].label]}`
  const lines: Record<string, string> = {
    Warm: 'Writes like someone who makes people feel at ease.',
    Curious: 'Writes like someone who always has one more question.',
    Playful: 'Writes like someone who can make a quiet room smile.',
    Thoughtful: 'Writes like someone who means what they say.',
  }
  return { title, line: lines[top[0].label], traits: top.slice(0, 3).sort((a, b) => b.value - a.value) }
}

const INK = '#10252B', EMBER = '#F9502C', PAPER = '#FAF7F1', SAGE = '#E8EFE6', SLATE = '#5B6B70'

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number) {
  let line = ''; let yy = y
  for (const w of text.split(' ')) {
    const t = line ? `${line} ${w}` : w
    if (ctx.measureText(t).width > max && line) { ctx.fillText(line, x, yy); line = w; yy += lh } else line = t
  }
  if (line) ctx.fillText(line, x, yy)
  return yy
}

function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const s = size / 256
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s)
  ctx.fillStyle = INK
  ctx.fill(new Path2D('M36,220V128A92,92 0 0 1 220,128V220H176V128A48,48 0 0 0 80,128V220Z'))
  ctx.fillStyle = EMBER; ctx.beginPath(); ctx.arc(128, 182, 22, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}

export type CardKind = 'style' | 'door'

/** Draws a 1080 x 1350 share card. `link` is shown as plain text so it still works in a screenshot. */
export async function drawCard(canvas: HTMLCanvasElement, kind: CardKind, style: NoteStyle | null, link: string) {
  try { await Promise.all([document.fonts.load('500 64px Fraunces'), document.fonts.load('400 32px Inter')]) } catch { /* fall back to system fonts */ }
  const W = 1080, H = 1350
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = SAGE; ctx.beginPath(); ctx.arc(W - 120, 160, 340, 0, Math.PI * 2); ctx.fill()
  drawMark(ctx, 90, 90, 110)
  ctx.fillStyle = INK; ctx.font = '500 52px Fraunces, Georgia, serif'; ctx.textBaseline = 'alphabetic'
  ctx.fillText(BRAND_NAME.toLowerCase(), 220, 168)

  if (kind === 'style' && style) {
    ctx.fillStyle = SLATE; ctx.font = '600 30px Inter, system-ui, sans-serif'
    ctx.fillText('MY NOTE STYLE', 90, 400)
    ctx.fillStyle = INK; ctx.font = '500 104px Fraunces, Georgia, serif'
    const end = wrap(ctx, style.title, 90, 520, W - 180, 116)
    ctx.fillStyle = SLATE; ctx.font = '400 38px Inter, system-ui, sans-serif'
    const after = wrap(ctx, style.line, 90, end + 90, W - 220, 54)
    let y = after + 110
    for (const t of style.traits) {
      ctx.fillStyle = INK; ctx.font = '600 32px Inter, system-ui, sans-serif'; ctx.fillText(t.label, 90, y)
      ctx.textAlign = 'right'; ctx.fillText(`${t.value}%`, W - 90, y); ctx.textAlign = 'left'
      ctx.fillStyle = '#E5E0D6'; ctx.beginPath(); ctx.roundRect(90, y + 20, W - 180, 18, 9); ctx.fill()
      ctx.fillStyle = EMBER; ctx.beginPath(); ctx.roundRect(90, y + 20, ((W - 180) * t.value) / 100, 18, 9); ctx.fill()
      y += 120
    }
  } else {
    ctx.fillStyle = INK; ctx.font = '500 116px Fraunces, Georgia, serif'
    const end = wrap(ctx, 'Words first. Photos never.', 90, 470, W - 180, 128)
    ctx.fillStyle = SLATE; ctx.font = '400 40px Inter, system-ui, sans-serif'
    wrap(ctx, 'A verified community where a short note opens the door, and she decides.', 90, end + 100, W - 240, 56)
  }

  ctx.fillStyle = INK; ctx.beginPath(); ctx.roundRect(90, H - 230, W - 180, 120, 60); ctx.fill()
  ctx.fillStyle = PAPER; ctx.font = '600 34px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'; ctx.fillText(link.replace(/^https?:\/\//, ''), W / 2, H - 160); ctx.textAlign = 'left'
  ctx.fillStyle = SLATE; ctx.font = '400 26px Inter, system-ui, sans-serif'
  ctx.fillText('18+ only. A person checks every member.', 90, H - 60)
}

export default function ShareCards({ bio }: { bio: string }) {
  const { data } = useMyInviteQuery()
  const style = useMemo(() => noteStyle(bio), [bio])
  const [kind, setKind] = useState<CardKind>(style ? 'style' : 'door')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const ref = useRef<HTMLCanvasElement>(null)
  const link = data ? `${window.location.origin}/signup?invite=${encodeURIComponent(data.code)}` : window.location.origin

  useEffect(() => { if (ref.current) void drawCard(ref.current, kind, style, link) }, [kind, style, link])

  async function toBlob(): Promise<Blob | null> {
    const c = ref.current
    if (!c) return null
    return new Promise((res) => c.toBlob((b) => res(b), 'image/png'))
  }
  async function share() {
    setBusy(true); setNote('')
    try {
      const blob = await toBlob()
      if (!blob) return
      const file = new File([blob], `${BRAND_NAME.toLowerCase()}-card.png`, { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text: link }); return }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000); setNote('Saved to your device.')
    } catch { /* share sheet closed */ } finally { setBusy(false) }
  }

  return (
    <section aria-labelledby="share-title" className={`${card} flex flex-col gap-4`}>
      <div>
        <h2 id="share-title" className="font-display text-xl">Share a card</h2>
        <p className="mt-1 text-[15px] text-slate">Made from your own words only. It never shows your name, age or anyone else, and nothing is uploaded.</p>
      </div>
      <div role="group" aria-label="Card style" className="flex gap-2">
        {style && <button type="button" aria-pressed={kind === 'style'} onClick={() => setKind('style')} className={kind === 'style' ? btnPrimary : btnSecondary}>My note style</button>}
        <button type="button" aria-pressed={kind === 'door'} onClick={() => setKind('door')} className={kind === 'door' ? btnPrimary : btnSecondary}>Invite card</button>
      </div>
      {!style && <p className="text-[13px] text-slate">Add a few lines to your bio and a "My note style" card will appear here.</p>}
      <canvas ref={ref} role="img" aria-label="Preview of your share card" className="w-full rounded-2xl border border-stone-200" style={{ aspectRatio: '1080 / 1350' }} />
      <button type="button" onClick={share} disabled={busy} className={btnPrimary}>{busy ? 'Preparing…' : 'Share or save'}</button>
      <p role="status" className="text-[13px] text-slate">{note || 'For fun only. It says nothing about whether you would suit anyone.'}</p>
    </section>
  )
}
