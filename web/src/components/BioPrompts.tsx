import { chip } from '../ui'

/** Starter lines that make a profile easier to write and more interesting to read. Tapping one adds it to the bio. */
export const BIO_PROMPTS = [
  'A perfect Sunday for me is…',
  "I'm quietly good at…",
  'Ask me about…',
  'The last thing that made me laugh was…',
  "I'm happiest when…",
  "Something I'd love to learn is…",
]

export default function BioPrompts({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] text-slate">Stuck? Tap a line to start. Specific is better than clever.</span>
      <ul className="flex flex-wrap gap-2">
        {BIO_PROMPTS.map((p) => (
          <li key={p}><button type="button" onClick={() => onPick(p + ' ')} className={`${chip} cursor-pointer transition hover:border-ink`}>{p}</button></li>
        ))}
      </ul>
    </div>
  )
}
