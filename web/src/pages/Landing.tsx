import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useSelector } from 'react-redux'
import type { RootState } from '../store'
import { BRAND_NAME } from '../brand'
import { LogoMark } from '../components/icons'
import { usePublicConfigQuery } from '../features/beta/api'
import { btnOutline, btnPrimary, eyebrow } from '../ui'
import { Waitlist } from './Auth'
import SupportContact from '../components/SupportContact'
import { feeReason } from '../features/onboarding/policy'

// All words on this page live here, so they are easy to edit.
const copy = {
  tagline: 'A verified community for conversation.',
  heroTitle: 'Every member is verified. Nobody is judged on photos.',
  heroBody: `${BRAND_NAME} is a place to meet people through a short note, not a picture. Everyone is checked by a real person before they come in.`,
  seeHow: 'See how it works',
  join: 'Join the community',
  joinInvite: 'I have an invite code',
  login: 'Log in',
  heroHooks: ['Say something real in your first message.', 'No photos to swipe. Just a note.', 'She can say Not now. No explanation needed.'],
  eyebrows: { how: 'Words first', is: 'Simple on purpose', safe: 'Checked by people', faq: 'Good to know' },
  pull1: 'A conversation, not a catalogue.',
  pull2: 'Every first impression is a sentence, not a photo.',
  reqTitle: 'What a request looks like',
  reqEyebrow: 'One note, one question',
  reqLabel: 'Example',
  reqFrom: 'A member, 29',
  reqNote: 'Hi, I read that you love long walks and old films. I am learning to cook and would enjoy hearing which film you would watch again. No pressure at all.',
  reqAccept: 'Accept',
  reqNotNow: 'Not now',
  reqCaption: 'A man sends one request with a short note. She decides. Not now needs no reason.',
  weekTitle: 'Your first week',
  weekEyebrow: 'What to expect',
  week: [
    ['Day 1', 'You sign up and send a selfie and a short voice clip.'],
    ['Next', 'A person on our team reviews them.'],
    ['You are in', 'Explore the wall. You can set filters for age, city, language and interest.'],
    ['Then', 'Send or answer your first request. If she accepts, you chat.'],
  ],
  comfortTitle: 'Built for comfort',
  comfortEyebrow: 'Made to feel easy',
  comfort: [
    ['Women are free', 'Joining and chatting cost women nothing.'],
    ['She decides', 'Nothing starts unless she says yes.'],
    ['Words first', 'No photos, so first impressions are what people write.'],
    ['Block or report anytime', 'You are always in control of who can reach you.'],
  ],
  forTitle: 'Who it is for',
  forEyebrow: 'Two sides, one idea',
  forWomen: ['If you are a woman', ['You choose who to talk to.', 'It is free for you.', 'Not now needs no reason.']],
  forMen: ['If you are a man', ['One thoughtful note beats a hundred swipes.', 'You only pay when you send a request.', 'Chat is free once she accepts.']],
  safeDetailTitle: 'How we keep it safe',
  safeDetail: [
    ['Verified members', 'A selfie and a voice clip, reviewed by a person.'],
    ['Block', 'Block anyone at any time.'],
    ['Report', 'Report a member from a chat or a request.'],
    ['Reviewed by people', 'Our admin team looks at each report.'],
  ],
  howTitle: 'How it works',
  steps: [
    { title: 'You verify', body: 'Send a selfie and a short voice clip. People on our team review them.', art: 'verify' },
    { title: 'No photos', body: 'There are no profile photos anywhere. You write a short note about you.', art: 'note' },
    { title: 'A man sends one request', body: 'He writes a short note to a woman and sends it.', art: 'send' },
    { title: 'She decides', body: 'She can accept, or say "Not now". She does not need to give a reason.', art: 'decide' },
    { title: 'Chat is free', body: 'After she accepts, you can talk by text or voice at no cost.', art: 'chat' },
  ],
  isTitle: 'What this is, and is not',
  isNot: `${BRAND_NAME} is not a dating app. It is a verified community for conversation, where you get to know someone by what they say.`,
  womenFree: 'Women are free.',
  menPay: 'Men pay per request: 10 requests for ₹499, or 20 for ₹899.',
  menFree: 'Requests are free during the closed beta.',
  chatFree: 'Chat is free for everyone once a request is accepted.',
  safetyTitle: 'Safety',
  safetyEyebrow: 'Safety',
  safety: [
    ['Verified members', 'Every member sends a selfie and a voice clip, and a person reviews them.'],
    ['Block and report', 'You can block anyone or report them from any chat or request.'],
    ['People review reports', 'Reports go to our admin team, and a person looks at each one.'],
  ],
  faqTitle: 'Questions',
  citiesDefault: 'We are starting in one city and will say which.',
  faq: [
    ['Is it free?', 'FEE_REASON'],
    ['Why no photos?', 'Photos make it easy to judge in a second. Here you start with a short note and a conversation, so people can be heard first.'],
    ['What does "Not now" mean?', 'It is a full answer. A woman can say it to any request without a reason, and it is kept simple and kind.'],
    ['How does verification work?', 'When you sign up, you send a selfie and a short voice clip. A person on our team reviews them before you can send or answer requests.'],
    ['Who sees my selfie and voice?', 'Only our review team sees them. They are never shown to other members. Both files are deleted once the review is decided.'],
    ['What is a request?', 'A request is one short note a man sends to a woman. She can accept it, or say "Not now".'],
    ['How many requests do I get?', 'BETA_REQUESTS'],
    ['Can I change my mind after accepting?', 'You can block anyone at any time, and report them if something is wrong.'],
    ['Which cities?', 'CITIES'],
    ['What languages?', 'Members list the languages they speak, and you can filter by them.'],
    ['Why is it invite only?', 'We are growing slowly so we can review every member carefully and keep the community safe.'],
  ],
  inviteTitle: 'Have an invite code?',
  inviteBody: 'Members can share an invite code. Use it to create your account.',
  openTitle: 'Come in',
  openBody: 'It takes a few minutes to sign up.',
  createAccount: 'Create your account',
}

/** Simple friendly illustrated person. No photos and no faces from real people. */
function Person({ x = 0, skin, hair, shirt, style = 'short', cls = '' }: { x?: number; skin: string; hair: string; shirt: string; style?: 'short' | 'long' | 'bun' | 'curly'; cls?: string }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <g className={`lp-bob ${cls}`}>
        {style === 'long' && <path d="M-26 -34c0-22 52-22 52 0v44h-12v-30h-28v30h-12z" fill={hair} />}
        {style === 'bun' && <circle cx="0" cy="-58" r="10" fill={hair} />}
        <path d="M-36 70c0-34 16-46 36-46s36 12 36 46z" fill={shirt} />
        <rect x="-6" y="14" width="12" height="14" rx="5" fill={skin} />
        <circle cx="0" cy="-12" r="26" fill={skin} />
        {style === 'curly'
          ? <path d="M-28 -14c-6-26 12-34 28-34s34 8 28 34c-4-14-14-20-28-20s-24 6-28 20z" fill={hair} />
          : <path d="M-27 -12c-4-24 10-32 27-32s31 8 27 32c-6-10-14-16-27-16s-21 6-27 16z" fill={hair} />}
        <g fill="var(--color-ink)">
          <ellipse className="lp-blink" cx="-9" cy="-9" rx="2.6" ry="3.2" />
          <ellipse className="lp-blink" cx="9" cy="-9" rx="2.6" ry="3.2" />
        </g>
        <path d="M-9 1q9 9 18 0" fill="none" stroke="var(--color-ink)" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="-16" cy="0" r="4" fill="var(--color-ember)" opacity=".18" />
        <circle cx="16" cy="0" r="4" fill="var(--color-ember)" opacity=".18" />
      </g>
    </g>
  )
}

function Bubble({ x, y, cls, children }: { x: number; y: number; cls: string; children?: ReactNode }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={`lp-pop ${cls}`}>
        <rect x="-22" y="-14" width="44" height="26" rx="13" fill="white" stroke="var(--color-fog)" />
        <path d="M-8 12l-4 8 12-8z" fill="white" stroke="var(--color-fog)" />
        {children ?? <g fill="var(--color-ink)"><circle cx="-9" cy="-1" r="2.5" /><circle cx="0" cy="-1" r="2.5" /><circle cx="9" cy="-1" r="2.5" /></g>}
      </g>
    </g>
  )
}

function HeroArt() {
  return (
    <svg viewBox="0 0 360 280" role="img" aria-label="Illustration of four smiling people of different ages and backgrounds, chatting in speech bubbles." className="h-auto w-full max-w-md">
      <rect x="10" y="20" width="340" height="250" rx="125" fill="var(--color-mist)" />
      <path d="M60 270V150a120 120 0 0 1 240 0v120h-40V150a80 80 0 0 0-160 0v120z" fill="var(--color-ink)" opacity=".08" />
      <circle cx="180" cy="236" r="16" fill="var(--color-ember)" />
      <g transform="translate(0 150)">
        <Person x={80} skin="#8D5A3B" hair="#2A1B14" shirt="var(--color-verified)" />
        <Person x={150} skin="#F1C9A5" hair="#6B3F24" shirt="var(--color-ember)" style="long" cls="lp-bob-2" />
        <Person x={220} skin="#C68A5E" hair="#10252B" shirt="#44585D" style="curly" cls="lp-bob-3" />
        <Person x={285} skin="#E0A87C" hair="#1C1C1C" shirt="#B9CBCD" style="bun" />
      </g>
      <Bubble x={105} y={70} cls="">{null}</Bubble>
      <Bubble x={185} y={48} cls="lp-pop-2" />
      <Bubble x={265} y={70} cls="lp-pop-3" />
    </svg>
  )
}

function StepArt({ kind }: { kind: string }) {
  const common = { viewBox: '0 0 120 90', 'aria-hidden': true as const, className: 'h-auto w-full' }
  const ink = 'var(--color-ink)'
  const ember = 'var(--color-ember)'
  switch (kind) {
    case 'verify': return (
      <svg {...common}><circle cx="45" cy="42" r="24" fill="var(--color-mist)" /><circle cx="45" cy="36" r="9" fill="none" stroke={ink} strokeWidth="3" /><path d="M30 58a15 12 0 0 1 30 0" fill="none" stroke={ink} strokeWidth="3" strokeLinecap="round" />
        <rect x="76" y="26" width="16" height="30" rx="8" fill="none" stroke={ink} strokeWidth="3" /><path d="M70 46a14 14 0 0 0 28 0" fill="none" stroke={ink} strokeWidth="3" strokeLinecap="round" />
        <circle className="lp-pulse" cx="96" cy="68" r="12" fill="var(--color-verified)" /><path className="lp-draw" d="M90 68l4 4 8-9" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>)
    case 'note': return (
      <svg {...common}><rect x="26" y="12" width="68" height="64" rx="10" fill="white" stroke="var(--color-fog)" strokeWidth="2" />
        <path className="lp-draw" d="M38 30h44M38 42h38M38 54h26" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />
        <g stroke={ember} strokeWidth="3" strokeLinecap="round"><path d="M92 14l14 14M106 14L92 28" opacity=".0" /></g>
        <circle className="lp-pulse" cx="86" cy="64" r="6" fill={ember} /></svg>)
    case 'send': return (
      <svg {...common}><circle cx="24" cy="46" r="12" fill="var(--color-verified)" /><path d="M8 80a16 14 0 0 1 32 0z" fill="var(--color-verified)" />
        <g className="lp-slide"><rect x="48" y="30" width="30" height="22" rx="4" fill={ember} /><path d="M48 33l15 11 15-11" fill="none" stroke={ink} strokeWidth="2.5" strokeLinejoin="round" /></g>
        <circle cx="98" cy="46" r="12" fill="#C68A5E" /><path d="M82 80a16 14 0 0 1 32 0z" fill="#C68A5E" /></svg>)
    case 'decide': return (
      <svg {...common}><rect x="10" y="22" width="46" height="40" rx="20" fill="var(--color-verified)" /><path className="lp-draw" d="M23 42l8 8 14-16" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="64" y="22" width="46" height="40" rx="20" fill="var(--color-mist)" stroke="var(--color-fog)" strokeWidth="2" /><path d="M78 42h18" stroke={ink} strokeWidth="4" strokeLinecap="round" />
        <text x="60" y="80" textAnchor="middle" fontSize="9" fill={ink} fontFamily="Inter, sans-serif">Accept or Not now</text></svg>)
    default: return (
      <svg {...common}><rect x="10" y="14" width="64" height="26" rx="13" fill="white" stroke="var(--color-fog)" strokeWidth="2" /><g fill={ink}><circle className="lp-pulse" cx="32" cy="27" r="3" /><circle className="lp-pulse" cx="42" cy="27" r="3" /><circle className="lp-pulse" cx="52" cy="27" r="3" /></g>
        <rect x="46" y="48" width="64" height="26" rx="13" fill={ember} /><path className="lp-draw" d="M60 61q4-8 8 0t8 0 8 0 8 0" fill="none" stroke={ink} strokeWidth="3" strokeLinecap="round" /></svg>)
  }
}

/** Fades a block in once it scrolls into view. Without IntersectionObserver it just shows. */
function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') { el.setAttribute('data-in', ''); return }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.setAttribute('data-in', ''); io.unobserve(e.target) } }), { threshold: 0.2 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return <div ref={ref} className={`lp-reveal ${className}`}>{children}</div>
}

export default function Landing() {
  const token = useSelector((s: RootState) => s.auth.token)
  const [params] = useSearchParams()
  const { data: cfg } = usePublicConfigQuery()
  const heroRef = useRef<HTMLElement>(null)
  const [stickyOn, setStickyOn] = useState(false)
  const invite = params.get('invite')

  useEffect(() => {
    document.documentElement.classList.add('lp-smooth')
    return () => document.documentElement.classList.remove('lp-smooth')
  }, [])
  useEffect(() => {
    const el = heroRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setStickyOn(!e.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [])

  if (token) return <Navigate to="/wall" replace />
  // Invite links shared as /?invite=CODE go straight to the signup form, which records the click.
  if (invite) return <Navigate to={`/signup?invite=${encodeURIComponent(invite)}`} replace />

  const inviteOnly = !!cfg?.inviteOnly
  const joinLabel = inviteOnly ? copy.joinInvite : copy.join
  const section = 'mx-auto w-full max-w-5xl px-5 py-14'
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-4">
        <span className="flex items-center gap-2.5"><LogoMark size={30} /><span className="font-display text-xl font-semibold">{BRAND_NAME}</span></span>
        <Link to="/login" className="inline-flex h-11 items-center rounded-full px-4 text-[15px] font-semibold underline">{copy.login}</Link>
      </header>
      <main>
        <section ref={heroRef} className="mx-auto grid w-full max-w-5xl items-center gap-8 px-5 py-8 md:grid-cols-2">
          <div className="flex flex-col gap-5">
            <p className={eyebrow}>{copy.tagline}</p>
            <h1 className="font-display text-[34px] font-semibold leading-tight md:text-5xl">{copy.heroTitle}</h1>
            <p className="text-base text-slate md:text-lg">{copy.heroBody}</p>
            <ul className="flex flex-col gap-1.5 border-l-4 border-ember pl-4 font-display text-[17px] font-medium">
              {copy.heroHooks.map((h) => <li key={h}>{h}</li>)}
            </ul>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link to="/signup" className={btnPrimary}>{joinLabel}</Link>
              <a href="#how" className={btnOutline}>{copy.seeHow}</a>
            </div>
          </div>
          <div className="flex justify-center"><HeroArt /></div>
        </section>

        <Reveal className="mx-auto w-full max-w-3xl px-5 py-6 text-center"><p className="font-display text-2xl font-semibold leading-snug md:text-3xl">{copy.pull1}</p></Reveal>
        <section id="how" className={section} aria-labelledby="how-h">
          <p className={eyebrow}>{copy.eyebrows.how}</p>
          <h2 id="how-h" className="font-display text-3xl font-semibold">{copy.howTitle}</h2>
          <ol className="mt-8 grid gap-5 md:grid-cols-5">
            {copy.steps.map((s, i) => (
              <li key={s.title}>
                <Reveal className="flex h-full flex-col gap-3 rounded-3xl bg-white p-5">
                  <div className="mx-auto w-28"><StepArt kind={s.art} /></div>
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-sm font-semibold text-paper">{i + 1}</span>
                  <h3 className="font-display text-lg font-semibold">{s.title}</h3>
                  <p className="text-[15px] text-slate">{s.body}</p>
                </Reveal>
              </li>
            ))}
          </ol>
        </section>

        <section className={section} aria-labelledby="req-h">
          <p className={eyebrow}>{copy.reqEyebrow}</p>
          <h2 id="req-h" className="font-display text-3xl font-semibold">{copy.reqTitle}</h2>
          <Reveal className="mt-6 grid items-center gap-6 md:grid-cols-2">
            <div className="rounded-3xl bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between"><span className="text-sm font-semibold">{copy.reqFrom}</span><span className="rounded-full bg-mist px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate">{copy.reqLabel}</span></div>
              <p className="mt-4 rounded-2xl bg-paper p-4 text-[15px]">{copy.reqNote}</p>
              <div className="mt-4 grid grid-cols-2 gap-3" aria-hidden="true">
                <span className="inline-flex h-12 items-center justify-center rounded-full bg-ember font-semibold">{copy.reqAccept}</span>
                <span className="inline-flex h-12 items-center justify-center rounded-full border border-stone-300 font-semibold">{copy.reqNotNow}</span>
              </div>
            </div>
            <p className="text-lg text-slate">{copy.reqCaption}</p>
          </Reveal>
        </section>

        <section className={section} aria-labelledby="week-h">
          <p className={eyebrow}>{copy.weekEyebrow}</p>
          <h2 id="week-h" className="font-display text-3xl font-semibold">{copy.weekTitle}</h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-4">
            {copy.week.map(([t, b], i) => (
              <li key={t}><Reveal className="h-full rounded-3xl bg-white p-5"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-ember text-sm font-semibold">{i + 1}</span><h3 className="mt-3 font-display text-lg font-semibold">{t}</h3><p className="mt-1 text-[15px] text-slate">{b}</p></Reveal></li>
            ))}
          </ol>
        </section>

        <section className={section} aria-labelledby="is-h">
          <Reveal className="rounded-3xl bg-mist p-6 md:p-10">
            <p className={eyebrow}>{copy.eyebrows.is}</p>
            <h2 id="is-h" className="font-display text-3xl font-semibold">{copy.isTitle}</h2>
            <p className="mt-4 max-w-2xl text-lg">{copy.isNot}</p>
            <p className="mt-4 max-w-2xl text-[15px] text-slate">{feeReason(cfg?.betaFree)}</p>
            <ul className="mt-5 flex flex-col gap-2 text-[15px] text-slate">
              <li><b className="text-ink">{copy.womenFree}</b></li>
              {cfg?.betaFree && <li><b className="text-verified">{copy.menFree}</b></li>}
              <li>{copy.chatFree}</li>
            </ul>
          </Reveal>
        </section>

        <section className={section} aria-labelledby="comfort-h">
          <p className={eyebrow}>{copy.comfortEyebrow}</p>
          <h2 id="comfort-h" className="font-display text-3xl font-semibold">{copy.comfortTitle}</h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            {copy.comfort.map(([t, b]) => (
              <li key={t}><Reveal className="h-full rounded-3xl bg-white p-5"><h3 className="font-display text-lg font-semibold">{t}</h3><p className="mt-2 text-[15px] text-slate">{b}</p></Reveal></li>
            ))}
          </ul>
        </section>

        <section className={section} aria-labelledby="for-h">
          <p className={eyebrow}>{copy.forEyebrow}</p>
          <h2 id="for-h" className="font-display text-3xl font-semibold">{copy.forTitle}</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {[copy.forWomen, copy.forMen].map(([h, items]) => (
              <Reveal key={h as string} className="rounded-3xl bg-mist p-6">
                <h3 className="font-display text-xl font-semibold">{h as string}</h3>
                <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-[15px]">{(items as string[]).map((i) => <li key={i}>{i}</li>)}</ul>
              </Reveal>
            ))}
          </div>
        </section>

        <Reveal className="mx-auto w-full max-w-3xl px-5 py-6 text-center"><p className="font-display text-2xl font-semibold leading-snug md:text-3xl">{copy.pull2}</p></Reveal>
        <section className={section} aria-labelledby="safe-h">
          <p className={eyebrow}>{copy.eyebrows.safe}</p>
          <h2 id="safe-h" className="font-display text-3xl font-semibold">{copy.safetyTitle}</h2>
          <ul className="mt-6 grid gap-4 md:grid-cols-3">
            {copy.safety.map(([t, b]) => (
              <li key={t}><Reveal className="h-full rounded-3xl bg-white p-5"><h3 className="font-display text-lg font-semibold">{t}</h3><p className="mt-2 text-[15px] text-slate">{b}</p></Reveal></li>
            ))}
          </ul>
          <Reveal className="mt-6 rounded-3xl bg-mist p-6">
            <h3 className="font-display text-xl font-semibold">{copy.safeDetailTitle}</h3>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              {copy.safeDetail.map(([t, b]) => <div key={t}><dt className="font-semibold">{t}</dt><dd className="text-[15px] text-slate">{b}</dd></div>)}
            </dl>
          </Reveal>
        </section>

        <section className="mx-auto w-full max-w-3xl px-5 py-14" aria-labelledby="faq-h">
          <p className={eyebrow}>{copy.eyebrows.faq}</p>
          <h2 id="faq-h" className="font-display text-3xl font-semibold">{copy.faqTitle}</h2>
          <div className="mt-6 flex flex-col gap-3">
            {copy.faq.filter(([q]) => inviteOnly || !q.includes('invite only')).map(([q, raw]) => {
              const a = raw === 'FEE_REASON' ? `${feeReason(cfg?.betaFree)} Chat is free once a request is accepted.`
                : raw === 'CITIES' ? (cfg?.betaCity ? `We are starting in ${cfg.betaCity}.` : copy.citiesDefault)
                : raw === 'BETA_REQUESTS' ? (cfg?.betaFree ? 'During the closed beta, requests are free for men. Later, men buy packs: 10 requests for ₹499 or 20 for ₹899.' : 'Men buy packs: 10 requests for ₹499 or 20 for ₹899. Women do not need requests.')
                : raw
              return (
              <details key={q} className="group rounded-2xl bg-white p-4">
                <summary className="cursor-pointer text-base font-semibold">{q}</summary>
                <p className="mt-2 text-[15px] text-slate">{a}</p>
              </details>
            )})}
          </div>
        </section>

        <section id="join" className="mx-auto w-full max-w-xl px-5 pb-28 pt-10 text-center" aria-labelledby="join-h">
          <h2 id="join-h" className="font-display text-3xl font-semibold">{inviteOnly ? copy.inviteTitle : copy.openTitle}</h2>
          <p className="mt-3 text-slate">{inviteOnly ? copy.inviteBody : copy.openBody}</p>
          <div className="mt-6 flex justify-center"><Link to="/signup" className={btnPrimary}>{inviteOnly ? copy.joinInvite : copy.createAccount}</Link></div>
          {inviteOnly && <div className="mt-8 text-left"><Waitlist /></div>}
          <SupportContact className="mt-6 text-slate" />
        </section>
      </main>
      <footer className="mx-auto flex w-full max-w-5xl flex-wrap gap-x-5 gap-y-2 px-5 pb-24 text-sm text-slate md:pb-10">
        <Link className="underline" to="/values">Community values</Link>
        <Link className="underline" to="/legal/terms">Terms</Link>
        <Link className="underline" to="/legal/privacy">Privacy</Link>
        <SupportContact />
      </footer>
      {stickyOn && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200 bg-paper/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
          <Link to="/signup" className={`${btnPrimary} w-full`}>{joinLabel}</Link>
        </div>
      )}
    </div>
  )
}
