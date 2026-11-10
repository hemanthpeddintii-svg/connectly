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

function parseList(s: string, max: number, noun: string): string[] | string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of s.split(',')) {
    const t = part.trim()
    if (!t || seen.has(t.toLowerCase())) continue
    if (t.length > 30) return `Each ${noun} can be at most 30 characters.`
    seen.add(t.toLowerCase())
    out.push(t)
  }
  return out.length > max ? `Use at most ${max} ${noun}s.` : out
}

function validate(minAge: string, maxAge: string, interests: string, city: string, languages: string): Prefs | string {
  const min = parseAge(minAge, 'Minimum age')
  if (typeof min === 'string') return min
  const max = parseAge(maxAge, 'Maximum age')
  if (typeof max === 'string') return max
  if (min !== null && max !== null && min > max) return 'Minimum age cannot be higher than maximum age.'
  const list = parseList(interests, 12, 'interest')
  if (typeof list === 'string') return list
  const langs = parseList(languages, 8, 'language')
  if (typeof langs === 'string') return langs
  if (city.trim().length > 60) return 'City can be at most 60 characters.'
  return { minAge: min, maxAge: max, interests: list, city: city.trim(), languages: langs }
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
  const [city, setCity] = useState(saved.city)
  const [languages, setLanguages] = useState(saved.languages.join(', '))
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [save, { isLoading: saving }] = useSavePreferencesMutation()
  const [clear, { isLoading: clearing }] = useClearPreferencesMutation()
  const busy = saving || clearing

  async function submit(e: FormEvent) {
    e.preventDefault()
    const result = validate(minAge, maxAge, interests, city, languages)
    if (typeof result === 'string') return setFeedback({ ok: false, text: result })
    try {
      const next = await save(result).unwrap()
      setInterests(next.interests.join(', '))
      setCity(next.city)
      setLanguages(next.languages.join(', '))
      setFeedback({ ok: true, text: 'Filters saved.' })
    } catch { setFeedback({ ok: false, text: 'Could not save your filters.' }) }
  }

  async function reset() {
    try {
      await clear().unwrap()
      setMinAge(''); setMaxAge(''); setInterests(''); setCity(''); setLanguages('')
      setFeedback({ ok: true, text: 'Filters cleared.' })
    } catch { setFeedback({ ok: false, text: 'Could not clear your filters.' }) }
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby="prefs-title" className="flex flex-col gap-3">
      <h2 id="prefs-title" className="text-lg font-semibold">Community filters</h2>
      <p className="text-sm text-stone-500">
        Only the profiles shown in your community are filtered. Your connections and chats are not affected, and nobody else can see these settings.
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
        City
        <input value={city} onChange={(e) => setCity(e.target.value)} maxLength={60} placeholder="Any city" className={field} />
        <span className="text-xs text-stone-500">Only members in this city are shown. Leave empty for everywhere.</span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Languages
        <input value={languages} onChange={(e) => setLanguages(e.target.value)} placeholder="English, Hindi" className={field} />
        <span className="text-xs text-stone-500">Comma separated. Members who speak at least one are shown. Leave empty to show everyone.</span>
      </label>
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
