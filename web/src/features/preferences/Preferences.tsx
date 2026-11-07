import { useState, type FormEvent } from 'react'
import {
  usePreferencesQuery, useSavePreferencesMutation, useClearPreferencesMutation, type Preferences as Prefs,
} from './api'

const MIN = 18
const MAX = 120
const field = 'w-full rounded-md border border-stone-300 bg-white px-3 py-2 outline-none focus:border-stone-900'

const parseAge = (s: string, label: string): number | null | string => {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  if (!Number.isInteger(n) || n < MIN || n > MAX) return `${label} must be a whole number from ${MIN} to ${MAX}.`
  return n
}

function parseInterests(s: string): string[] | string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of s.split(',')) {
    const t = part.trim()
    if (!t || seen.has(t.toLowerCase())) continue
    if (t.length > 30) return 'Each interest can be at most 30 characters.'
    seen.add(t.toLowerCase())
    out.push(t)
  }
  return out.length > 12 ? 'Use at most 12 interests.' : out
}

function validate(minAge: string, maxAge: string, interests: string): Prefs | string {
  const min = parseAge(minAge, 'Minimum age')
  if (typeof min === 'string') return min
  const max = parseAge(maxAge, 'Maximum age')
  if (typeof max === 'string') return max
  if (min !== null && max !== null && min > max) return 'Minimum age cannot be higher than maximum age.'
  const list = parseInterests(interests)
  if (typeof list === 'string') return list
  return { minAge: min, maxAge: max, interests: list }
}

export default function Preferences() {
  const { data, isLoading, isError } = usePreferencesQuery()
  if (isLoading) return <p className="text-stone-500">Loading filters…</p>
  if (isError || !data) return <p role="alert" className="text-sm text-red-600">Could not load your filters.</p>
  return <PreferencesForm saved={data} />
}

function PreferencesForm({ saved }: { saved: Prefs }) {
  const [minAge, setMinAge] = useState(saved.minAge?.toString() ?? '')
  const [maxAge, setMaxAge] = useState(saved.maxAge?.toString() ?? '')
  const [interests, setInterests] = useState(saved.interests.join(', '))
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [save, { isLoading: saving }] = useSavePreferencesMutation()
  const [clear, { isLoading: clearing }] = useClearPreferencesMutation()
  const busy = saving || clearing

  async function submit(e: FormEvent) {
    e.preventDefault()
    const result = validate(minAge, maxAge, interests)
    if (typeof result === 'string') return setFeedback({ ok: false, text: result })
    try {
      const next = await save(result).unwrap()
      setInterests(next.interests.join(', '))
      setFeedback({ ok: true, text: 'Filters saved.' })
    } catch { setFeedback({ ok: false, text: 'Could not save your filters.' }) }
  }

  async function reset() {
    try {
      await clear().unwrap()
      setMinAge(''); setMaxAge(''); setInterests('')
      setFeedback({ ok: true, text: 'Filters cleared.' })
    } catch { setFeedback({ ok: false, text: 'Could not clear your filters.' }) }
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby="prefs-title" className="flex flex-col gap-3">
      <h2 id="prefs-title" className="text-lg font-semibold">Wall filters</h2>
      <p className="text-sm text-stone-500">
        Only the profiles shown on your wall are filtered. Your connections and chats are not affected, and nobody else can see these settings.
      </p>
      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Minimum age
          <input type="number" inputMode="numeric" min={MIN} max={MAX} step={1} value={minAge} onChange={(e) => setMinAge(e.target.value)} placeholder="Any" className={field} />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Maximum age
          <input type="number" inputMode="numeric" min={MIN} max={MAX} step={1} value={maxAge} onChange={(e) => setMaxAge(e.target.value)} placeholder="Any" className={field} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Interests
        <input value={interests} onChange={(e) => setInterests(e.target.value)} placeholder="hiking, jazz, cooking" className={field} />
        <span className="text-xs text-stone-500">Comma separated. Profiles that share at least one are shown. Leave empty to show everyone.</span>
      </label>
      {feedback && (
        <p role={feedback.ok ? 'status' : 'alert'} className={`text-sm ${feedback.ok ? 'text-emerald-700' : 'text-red-600'}`}>{feedback.text}</p>
      )}
      <div className="flex gap-2">
        <button disabled={busy} className="rounded-md bg-stone-900 px-4 py-2 text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={reset} disabled={busy} className="rounded-md border border-stone-300 px-4 py-2 disabled:opacity-50">
          {clearing ? 'Clearing…' : 'Clear filters'}
        </button>
      </div>
    </form>
  )
}
