import type { Gender } from '../api'

const JOINING: { value: Gender; label: string; help: string }[] = [
  { value: 'man', label: 'Man', help: 'You send requests, with a short note, to women you\'d like to meet.' },
  { value: 'woman', label: 'Woman', help: 'You receive requests and accept the ones you want to answer.' },
]

/** The "I'm joining as" radio group, shared by sign-up and the one-time chooser for older accounts. */
export default function JoiningAs() {
  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="mb-2 text-[15px] font-semibold">I'm joining as</legend>
      {JOINING.map((o) => (
        <label key={o.value} className="flex min-h-[64px] cursor-pointer items-start gap-3 rounded-2xl border border-stone-300 bg-white p-3.5 has-[:checked]:border-ink has-[:checked]:ring-1 has-[:checked]:ring-ink">
          <input type="radio" name="joining-as" value={o.value} required className="mt-1 h-5 w-5 flex-none accent-ink" />
          <span className="flex flex-col gap-0.5">
            <b className="text-base">{o.label}</b>
            <span className="text-[13px] leading-snug text-slate">{o.help}</span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}
