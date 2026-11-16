import { useState } from 'react'
import Sheet from '../../components/Sheet'
import { usePreferencesQuery, useSavePreferencesMutation, useClearPreferencesMutation, type Preferences } from './api'
import { btnOutline, btnPrimary, field } from '../../ui'

const CITIES = ['Hyderabad', 'Bangalore', 'Chennai', 'Mumbai', 'Delhi', 'Pune', 'Kolkata', 'Visakhapatnam', 'Vijayawada', 'Kochi', 'Ahmedabad', 'Jaipur']
const LANGUAGES = ['English', 'Hindi', 'Telugu', 'Tamil', 'Kannada', 'Malayalam', 'Marathi', 'Bengali', 'Gujarati', 'Punjabi', 'Urdu', 'Odia']
const INTERESTS = ['Films', 'Music', 'Travel', 'Cooking', 'Books', 'Fitness', 'Trekking', 'Photography', 'Gaming', 'Art', 'Cricket', 'Dance']
const AGE_PRESETS: Array<[string, number | null, number | null]> = [['Any', null, null], ['18–25', 18, 25], ['26–30', 26, 30], ['31–35', 31, 35], ['36–45', 36, 45], ['46+', 46, null]]

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
const withSaved = (options: string[], saved: string[]) => [...options, ...saved.filter((s) => !options.some((o) => same(o, s)))]

/** A short label for each active filter, used for the removable chips on the community screen. */
export function activeFilters(p: Preferences): Array<{ key: string; label: string }> {
  const out: Array<{ key: string; label: string }> = []
  if (p.minAge !== null || p.maxAge !== null) {
    out.push({ key: 'age', label: p.minAge !== null && p.maxAge !== null ? `Age ${p.minAge}–${p.maxAge}` : p.minAge !== null ? `Age ${p.minAge}+` : `Age up to ${p.maxAge}` })
  }
  if (p.city) out.push({ key: 'city', label: p.city })
  if (p.languages.length) out.push({ key: 'languages', label: p.languages.join(', ') })
  if (p.interests.length) out.push({ key: 'interests', label: p.interests.join(', ') })
  return out
}

function Chips({ label, options, selected, onToggle }: { label: string; options: string[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.some((s) => same(s, o))
        return (
          <button key={o} type="button" aria-pressed={on} onClick={() => onToggle(o)}
            className={`h-10 rounded-full border px-4 text-sm transition duration-200 ${on ? 'border-ink bg-ink font-medium text-paper' : 'border-stone-300 bg-white text-ink hover:border-ink'}`}>{o}</button>
        )
      })}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-t border-stone-200 pt-4 first:border-t-0 first:pt-0">
      <div><h3 className="text-[15px] font-semibold">{title}</h3><p className="text-[13px] text-slate">{hint}</p></div>
      {children}
    </section>
  )
}

/** Choose who shows up in the community: age, city, languages, interests. Saved to the same filters as Settings. */
export default function FilterSheet({ onClose }: { onClose: () => void }) {
  const { data: saved } = usePreferencesQuery()
  const [save, { isLoading: saving }] = useSavePreferencesMutation()
  const [clear, { isLoading: clearing }] = useClearPreferencesMutation()
  const [draft, setDraft] = useState<Preferences | null>(null)
  const [custom, setCustom] = useState({ city: '', language: '', interest: '' })
  const [error, setError] = useState('')
  const p = draft ?? saved
  if (!p) return <Sheet title="Filters" onClose={onClose}><p role="status" className="text-slate">Loading…</p></Sheet>
  const set = (patch: Partial<Preferences>) => setDraft({ ...p, ...patch })
  const toggle = (list: string[], v: string) => (list.some((s) => same(s, v)) ? list.filter((s) => !same(s, v)) : [...list, v])
  const addCustom = (k: 'language' | 'interest') => {
    const v = custom[k].trim().slice(0, 30)
    if (!v) return
    if (k === 'language' && p.languages.length < 8 && !p.languages.some((s) => same(s, v))) set({ languages: [...p.languages, v] })
    if (k === 'interest' && p.interests.length < 12 && !p.interests.some((s) => same(s, v))) set({ interests: [...p.interests, v] })
    setCustom({ ...custom, [k]: '' })
  }
  const ageNumber = (s: string) => (s.trim() === '' ? null : Math.round(Number(s)))

  async function apply() {
    if (p!.minAge !== null && p!.maxAge !== null && p!.minAge > p!.maxAge) return setError('The first age cannot be higher than the second.')
    if ([p!.minAge, p!.maxAge].some((n) => n !== null && (Number.isNaN(n) || n < 18 || n > 120))) return setError('Ages must be between 18 and 120.')
    setError('')
    try { await save(p!).unwrap(); onClose() } catch { setError("Couldn't save your filters. Try again.") }
  }
  async function reset() {
    try { await clear().unwrap(); onClose() } catch { setError("Couldn't clear your filters. Try again.") }
  }
  const busy = saving || clearing

  return (
    <Sheet title="Filters" onClose={onClose}>
      <p className="-mt-1 text-[13px] text-slate">Only changes who you see in the community. Nobody else can see these.</p>
      <Section title="Age" hint="Pick a range, or type your own.">
        <Chips label="Age ranges" options={AGE_PRESETS.map((a) => a[0])}
          selected={AGE_PRESETS.filter((a) => a[1] === p.minAge && a[2] === p.maxAge).map((a) => a[0])}
          onToggle={(label) => { const a = AGE_PRESETS.find((x) => x[0] === label)!; set({ minAge: a[1], maxAge: a[2] }) }} />
        <div className="flex items-center gap-3">
          <label className="flex flex-1 flex-col gap-1 text-[13px] text-slate">From
            <input type="number" inputMode="numeric" min={18} max={120} value={p.minAge ?? ''} placeholder="Any" onChange={(e) => set({ minAge: ageNumber(e.target.value) })} className={field} /></label>
          <label className="flex flex-1 flex-col gap-1 text-[13px] text-slate">To
            <input type="number" inputMode="numeric" min={18} max={120} value={p.maxAge ?? ''} placeholder="Any" onChange={(e) => set({ maxAge: ageNumber(e.target.value) })} className={field} /></label>
        </div>
      </Section>
      <Section title="City" hint="Where she lives. Choose one, or leave empty for everywhere.">
        <Chips label="City" options={withSaved(CITIES, p.city ? [p.city] : [])} selected={p.city ? [p.city] : []}
          onToggle={(c) => set({ city: same(p.city, c) ? '' : c })} />
        <input aria-label="Another city" value={custom.city} maxLength={60} placeholder="Another city"
          onChange={(e) => { setCustom({ ...custom, city: e.target.value }); set({ city: e.target.value.trim() }) }} className={field} />
      </Section>
      <Section title="Languages" hint="Shows women who speak at least one of these.">
        <Chips label="Languages" options={withSaved(LANGUAGES, p.languages)} selected={p.languages} onToggle={(v) => set({ languages: toggle(p.languages, v) })} />
        <div className="flex gap-2">
          <input aria-label="Add another language" value={custom.language} maxLength={30} placeholder="Add another language"
            onChange={(e) => setCustom({ ...custom, language: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom('language') } }} className={field} />
          <button type="button" onClick={() => addCustom('language')} className={`${btnOutline} !h-[50px] !px-4`}>Add</button>
        </div>
      </Section>
      <Section title="Interests" hint="Shows women who share at least one.">
        <Chips label="Interests" options={withSaved(INTERESTS, p.interests)} selected={p.interests} onToggle={(v) => set({ interests: toggle(p.interests, v) })} />
        <div className="flex gap-2">
          <input aria-label="Add another interest" value={custom.interest} maxLength={30} placeholder="Add another interest"
            onChange={(e) => setCustom({ ...custom, interest: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom('interest') } }} className={field} />
          <button type="button" onClick={() => addCustom('interest')} className={`${btnOutline} !h-[50px] !px-4`}>Add</button>
        </div>
      </Section>
      {error && <p role="alert" className="text-sm text-ember-deep">{error}</p>}
      <div className="sticky bottom-0 -mx-6 -mb-8 flex gap-3 border-t border-stone-200 bg-white px-6 py-4">
        <button type="button" onClick={reset} disabled={busy} className={`${btnOutline} flex-1`}>Clear all</button>
        <button type="button" onClick={apply} disabled={busy} className={`${btnPrimary} flex-[1.5]`}>{saving ? 'Saving…' : 'Show results'}</button>
      </div>
    </Sheet>
  )
}
