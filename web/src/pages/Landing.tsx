import { seasonWash } from '../season'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useSelector } from 'react-redux'
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'motion/react'
import type { RootState } from '../store'
import { BRAND_NAME } from '../brand'
import { LogoMark } from '../components/icons'
import { Reveal, Stagger, StaggerItem, ease, useStill } from '../components/motion'
import { usePublicConfigQuery } from '../features/beta/api'
import { btnOutline, btnPrimary, eyebrow } from '../ui'
import { Waitlist } from './Auth'
import SupportContact from '../components/SupportContact'
import GrievanceContact from '../components/GrievanceContact'
import { feeReason } from '../features/onboarding/policy'

// All words on this page live here, so they are easy to edit.
const copy = {
  tagline: 'A verified community for conversation',
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
  pull3: 'Not now is a full answer. And a kind one.',
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
    ['Nothing to buy for her', 'Requests are what men send. She only has to answer, or not.'],
    ['She decides', 'Nothing starts unless she says yes.'],
    ['Words first', 'No photos, so first impressions are what people write.'],
    ['Block or report anytime', 'You are always in control of who can reach you.'],
  ],
  forTitle: 'Who it is for',
  forEyebrow: 'Two sides, one idea',
  forWomen: ['If you are a woman', ['You choose who to talk to.', 'Requests are for others to send. You only ever reply.', 'Not now needs no reason.']],
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
    ['What does "verified" mean?', 'A person on our team checks a selfie and a short voice clip to confirm a real person is behind each profile. It is not a background check: we do not check documents or records, and verification does not guarantee who someone is. Please read our safety page.'],
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

/* ------------------------------------------------------------------ hero art */

/** A simple friendly illustrated person. No photos and no faces from real people. */
function Person({ x = 0, skin, hair, shirt, style = 'short', cls = '' }: { x?: number; skin: string; hair: string; shirt: string; style?: 'short' | 'long' | 'bun' | 'curly'; cls?: string }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <g className={`lp-bob ${cls}`}>
        {style === 'long' && <path d="M-26 -34c0-22 52-22 52 0v44h-12v-30h-28v30h-12z" fill={hair} />}
        {style === 'bun' && <circle cx="0" cy="-48" r="10" fill={hair} />}
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

/** The doorway draws itself, the dot lights up, and four people step into it. */
function HeroArt() {
  const still = useStill()
  const t = (delay: number, duration = 0.7) => (still ? { duration: 0 } : { duration, delay, ease })
  const people = [
    { x: 92, skin: '#8D5A3B', hair: '#2A1B14', shirt: 'var(--color-verified)', style: 'short' as const, cls: '' },
    { x: 154, skin: '#F1C9A5', hair: '#6B3F24', shirt: 'var(--color-ember)', style: 'long' as const, cls: 'lp-bob-2' },
    { x: 216, skin: '#C68A5E', hair: '#10252B', shirt: '#44585D', style: 'curly' as const, cls: 'lp-bob-3' },
    { x: 272, skin: '#E0A87C', hair: '#1C1C1C', shirt: '#B9CBCD', style: 'bun' as const, cls: '' },
  ]
  return (
    <svg viewBox="0 0 360 340" role="img" aria-label="Illustration of four smiling people of different ages and backgrounds standing together in a doorway."
      className="h-auto w-full max-w-[420px]">
      <motion.path d="M40 330V150a140 140 0 0 1 280 0v180" fill="none" stroke="var(--color-ink)" strokeWidth="5" strokeLinecap="round"
        initial={{ pathLength: still ? 1 : 0 }} animate={{ pathLength: 1 }} transition={t(0.1, 1.5)} />
      <motion.path d="M70 330V152a110 110 0 0 1 220 0v178z" fill="var(--color-sage)"
        initial={{ opacity: still ? 1 : 0 }} animate={{ opacity: 1 }} transition={t(0.9, 0.9)} />
      <motion.circle cx="180" cy="314" r="11" fill="var(--color-ember)" className="lp-breathe"
        initial={{ scale: still ? 1 : 0 }} animate={{ scale: 1 }} transition={t(1.2, 0.6)} />
      <g transform="translate(0 220)">
        {people.map((p, i) => (
          <motion.g key={p.x} initial={{ opacity: still ? 1 : 0, y: still ? 0 : 22 }} animate={{ opacity: 1, y: 0 }} transition={t(1.3 + i * 0.14, 0.7)}>
            <Person x={p.x} skin={p.skin} hair={p.hair} shirt={p.shirt} style={p.style} cls={p.cls} />
          </motion.g>
        ))}
      </g>
      {[{ x: 110, y: 96 }, { x: 180, y: 60 }, { x: 252, y: 96 }].map((b, i) => (
        <g key={b.x} transform={`translate(${b.x} ${b.y})`}>
          <motion.g initial={{ opacity: still ? 1 : 0, scale: still ? 1 : 0.6 }} animate={{ opacity: 1, scale: 1 }}
            transition={t(2.1 + i * 0.25, 0.5)} style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
            <rect x="-24" y="-15" width="48" height="28" rx="14" fill="white" stroke="var(--color-fog)" />
            <path d="M-8 13l-4 8 12-8z" fill="white" stroke="var(--color-fog)" />
            <g fill="var(--color-ink)"><circle cx="-9" cy="-1" r="2.5" /><circle cx="0" cy="-1" r="2.5" /><circle cx="9" cy="-1" r="2.5" /></g>
          </motion.g>
        </g>
      ))}
    </svg>
  )
}

/* ------------------------------------------------------------ journey scenes */

const ink = 'var(--color-ink)'
const ember = 'var(--color-ember)'
const draw = (delay = 0) => ({ initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: { duration: 0.8, delay, ease } })

/** One small animated scene per step. Each plays once when its step comes into view. */
function Scene({ kind }: { kind: string }) {
  const common = { viewBox: '0 0 240 190', 'aria-hidden': true as const, className: 'h-full w-full' }
  switch (kind) {
    case 'verify': return (
      <svg {...common}>
        <circle cx="86" cy="86" r="44" fill="var(--color-sage)" />
        <motion.circle cx="86" cy="76" r="16" fill="none" stroke={ink} strokeWidth="4" {...draw(0.1)} />
        <motion.path d="M58 118a28 22 0 0 1 56 0" fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round" {...draw(0.3)} />
        <motion.rect x="150" y="52" width="26" height="48" rx="13" fill="none" stroke={ink} strokeWidth="4" {...draw(0.5)} />
        <motion.path d="M140 90a23 23 0 0 0 46 0M163 113v14" fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round" {...draw(0.7)} />
        <motion.circle cx="190" cy="140" r="20" fill="var(--color-verified)" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ duration: 0.5, delay: 1.1, ease }} style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
        <motion.path d="M180 140l7 7 13-15" fill="none" stroke="white" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" {...draw(1.4)} />
      </svg>)
    case 'note': return (
      <svg {...common}>
        <rect x="52" y="22" width="136" height="146" rx="18" fill="white" stroke="var(--color-stone-300)" strokeWidth="2" />
        <motion.path d="M76 60h88" stroke={ink} strokeWidth="5" strokeLinecap="round" fill="none" {...draw(0.2)} />
        <motion.path d="M76 86h72" stroke={ink} strokeWidth="5" strokeLinecap="round" fill="none" {...draw(0.55)} />
        <motion.path d="M76 112h50" stroke={ink} strokeWidth="5" strokeLinecap="round" fill="none" {...draw(0.9)} />
        <motion.circle cx="138" cy="112" r="6" fill={ember} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }} className="lp-breathe" />
      </svg>)
    case 'send': return (
      <svg {...common}>
        <circle cx="48" cy="84" r="22" fill="var(--color-verified)" /><path d="M16 150a32 28 0 0 1 64 0z" fill="var(--color-verified)" />
        <circle cx="192" cy="84" r="22" fill="#C68A5E" /><path d="M160 150a32 28 0 0 1 64 0z" fill="#C68A5E" />
        <motion.g initial={{ x: -34, opacity: 0 }} animate={{ x: 32, opacity: 1 }} transition={{ duration: 1.3, delay: 0.3, ease }}>
          <rect x="62" y="56" width="52" height="38" rx="8" fill={ember} />
          <path d="M62 62l26 19 26-19" fill="none" stroke={ink} strokeWidth="3.5" strokeLinejoin="round" />
        </motion.g>
      </svg>)
    case 'decide': return (
      <svg {...common}>
        <motion.rect x="20" y="52" width="92" height="78" rx="39" fill="var(--color-verified)" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5, ease }} style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
        <motion.path d="M46 92l16 16 28-32" fill="none" stroke="white" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" {...draw(0.5)} />
        <motion.rect x="128" y="52" width="92" height="78" rx="39" fill="var(--color-mist)" stroke="var(--color-stone-300)" strokeWidth="2" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5, delay: 0.25, ease }} style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
        <motion.path d="M160 91h28" stroke={ink} strokeWidth="7" strokeLinecap="round" {...draw(0.8)} />
        <text x="120" y="164" textAnchor="middle" fontSize="13" fill={ink} fontFamily="Inter, sans-serif">Accept, or Not now</text>
      </svg>)
    default: return (
      <svg {...common}>
        <motion.g initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6, ease }}>
          <rect x="22" y="34" width="124" height="46" rx="23" fill="white" stroke="var(--color-stone-300)" strokeWidth="2" />
          <g fill={ink}><circle className="lp-bob" cx="64" cy="57" r="4.5" /><circle className="lp-bob lp-bob-2" cx="84" cy="57" r="4.5" /><circle className="lp-bob lp-bob-3" cx="104" cy="57" r="4.5" /></g>
        </motion.g>
        <motion.g initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6, delay: 0.5, ease }}>
          <rect x="94" y="102" width="124" height="46" rx="23" fill={ember} />
          <motion.path d="M118 125q6-12 12 0t12 0 12 0 12 0" fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round" {...draw(1)} />
        </motion.g>
      </svg>)
  }
}

/**
 * The story, told while you scroll. On a phone or a laptop the picture stays put and the words move through five steps.
 * With reduced motion it is five plain cards instead.
 */
function Journey() {
  const still = useStill()
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const [active, setActive] = useState(0)
  const steps = copy.steps
  useMotionValueEvent(scrollYProgress, 'change', (v) => setActive(Math.min(steps.length - 1, Math.max(0, Math.floor(v * steps.length)))))

  if (still) {
    return (
      <ol className="mt-8 grid gap-4 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-col gap-3 rounded-[22px] border border-stone-200 bg-white p-5">
            <div className="h-36"><Scene kind={s.art} /></div>
            <span className="text-xs font-medium tracking-[0.14em] text-slate">0{i + 1}</span>
            <h3 className="font-display text-xl">{s.title}</h3>
            <p className="text-[15px] text-slate">{s.body}</p>
          </li>
        ))}
      </ol>
    )
  }
  return (
    <div ref={ref} style={{ height: `${steps.length * 80}vh` }} className="relative">
      <div className="sticky top-0 flex h-dvh flex-col justify-center gap-6 py-16 md:grid md:grid-cols-2 md:items-center md:gap-14">
        <div className="mx-auto aspect-[240/190] w-full max-w-[420px] rounded-[32px] border border-stone-200 bg-white p-6 shadow-soft">
          <AnimatePresence mode="wait">
            <motion.div key={active} className="h-full w-full" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.02 }} transition={{ duration: 0.35, ease }}>
              <Scene kind={steps[active].art} />
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="relative flex gap-5 pl-1">
          <div aria-hidden="true" className="relative hidden w-px flex-none bg-stone-200 md:block">
            <motion.div className="absolute inset-x-0 top-0 h-full origin-top bg-ink" style={{ scaleY: scrollYProgress }} />
          </div>
          <ol className="flex flex-col gap-6">
            {steps.map((s, i) => (
              <li key={s.title} aria-current={i === active ? 'step' : undefined}
                className={`${i === active ? 'flex' : 'hidden md:flex'} flex-col gap-1.5 transition-opacity duration-500 ${i === active ? 'opacity-100' : 'opacity-35'}`}>
                <span className="text-xs font-medium tracking-[0.14em] text-slate">0{i + 1} / 0{steps.length}</span>
                <h3 className="font-display text-[28px] leading-tight md:text-[32px]">{s.title}</h3>
                <p className="max-w-sm text-base text-slate">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------- page */

function SectionHead({ eyebrowText, title, id }: { eyebrowText: string; title: string; id: string }) {
  return (
    <Reveal className="flex flex-col gap-3">
      <p className={eyebrow}>{eyebrowText}</p>
      <h2 id={id} className="font-display text-[34px] leading-[1.1] md:text-[44px]">{title}</h2>
    </Reveal>
  )
}

function Pull({ children }: { children: ReactNode }) {
  return (
    <Reveal className="mx-auto w-full max-w-3xl px-5 py-20 text-center">
      <p className="font-display text-[30px] leading-[1.2] md:text-[44px]">{children}</p>
    </Reveal>
  )
}

export default function Landing() {
  const token = useSelector((s: RootState) => s.auth.token)
  const [params] = useSearchParams()
  const { data: cfg } = usePublicConfigQuery()
  const heroRef = useRef<HTMLElement>(null)
  const [stickyOn, setStickyOn] = useState(false)
  const [scrolled, setScrolled] = useState(false)
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
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  if (token) return <Navigate to="/wall" replace />
  // Invite links shared as /?invite=CODE go straight to the signup form, which records the click.
  if (invite) return <Navigate to={`/signup?invite=${encodeURIComponent(invite)}`} replace />

  const inviteOnly = !!cfg?.inviteOnly
  const joinLabel = inviteOnly ? copy.joinInvite : copy.join
  const section = 'mx-auto w-full max-w-5xl px-5 py-20'
  return (
    <div className="min-h-dvh">
      <header className={`sticky top-0 z-30 transition-colors duration-300 ${scrolled ? 'border-b border-stone-200 bg-paper/85 backdrop-blur-md' : 'border-b border-transparent'}`}>
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-5">
          <span className="flex items-center gap-2.5"><LogoMark size={28} /><span className="font-display text-[23px] leading-none">{BRAND_NAME.toLowerCase()}</span></span>
          <Link to="/login" className="inline-flex h-11 items-center rounded-full px-4 text-[15px] font-medium text-ink transition-colors hover:bg-mist">{copy.login}</Link>
        </div>
      </header>
      <main>
        <section ref={heroRef} style={{ backgroundImage: seasonWash() }} className="mx-auto grid w-full max-w-5xl items-center gap-10 px-5 pb-16 pt-8 md:grid-cols-[1.1fr_1fr] md:pb-24 md:pt-14">
          <div className="flex flex-col gap-6">
            <Reveal y={12}><p className={eyebrow}>{copy.tagline}</p></Reveal>
            <Reveal y={16} delay={0.08}><h1 className="font-display text-[42px] leading-[1.04] md:text-[52px] lg:text-[62px]">{copy.heroTitle}</h1></Reveal>
            <Reveal y={16} delay={0.16}><p className="max-w-lg text-[17px] leading-relaxed text-slate">{copy.heroBody}</p></Reveal>
            <Reveal y={16} delay={0.24} className="flex flex-col gap-3 sm:flex-row">
              <Link to="/signup" className={btnPrimary}>{joinLabel}</Link>
              <a href="#how" className={btnOutline}>{copy.seeHow}</a>
            </Reveal>
            <Stagger as="ul" className="flex flex-col gap-2 pt-2 text-[15px] text-slate">
              {copy.heroHooks.map((h) => (
                <StaggerItem as="li" key={h} className="flex items-center gap-3">
                  <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-ember" />{h}
                </StaggerItem>
              ))}
            </Stagger>
          </div>
          <div className="flex justify-center md:justify-end"><HeroArt /></div>
        </section>

        <Pull>{copy.pull1}</Pull>

        <section id="how" className="mx-auto w-full max-w-5xl px-5 pt-10" aria-labelledby="how-h">
          <SectionHead eyebrowText={copy.eyebrows.how} title={copy.howTitle} id="how-h" />
          <Journey />
        </section>

        <section className={section} aria-labelledby="req-h">
          <SectionHead eyebrowText={copy.reqEyebrow} title={copy.reqTitle} id="req-h" />
          <div className="mt-10 grid items-center gap-10 md:grid-cols-2">
            <Reveal>
              <div className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-soft">
                <div className="flex items-center justify-between"><span className="text-sm font-semibold">{copy.reqFrom}</span><span className="rounded-full bg-mist px-3 py-1 text-xs font-medium uppercase tracking-wider text-slate">{copy.reqLabel}</span></div>
                <p className="mt-4 rounded-2xl bg-paper p-4 text-[15px] leading-relaxed">{copy.reqNote}</p>
                <div className="mt-4 grid grid-cols-2 gap-3" aria-hidden="true">
                  <span className="inline-flex h-12 items-center justify-center rounded-full bg-ember font-semibold">{copy.reqAccept}</span>
                  <span className="inline-flex h-12 items-center justify-center rounded-full border border-stone-300 font-medium">{copy.reqNotNow}</span>
                </div>
              </div>
            </Reveal>
            <Reveal delay={0.12}><p className="font-display text-[26px] leading-snug md:text-[30px]">{copy.reqCaption}</p></Reveal>
          </div>
        </section>

        <section className={section} aria-labelledby="week-h">
          <SectionHead eyebrowText={copy.weekEyebrow} title={copy.weekTitle} id="week-h" />
          <Stagger as="ol" className="mt-10 grid gap-8 md:grid-cols-4 md:gap-6">
            {copy.week.map(([t, b], i) => (
              <StaggerItem as="li" key={t} className="flex flex-col gap-2 border-t border-ink pt-4">
                <span className="text-xs font-medium tracking-[0.14em] text-slate">0{i + 1}</span>
                <h3 className="font-display text-2xl">{t}</h3>
                <p className="text-[15px] leading-relaxed text-slate">{b}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </section>

        <section className={section} aria-labelledby="is-h">
          <Reveal className="rounded-[32px] bg-sage p-8 md:p-14">
            <p className={eyebrow}>{copy.eyebrows.is}</p>
            <h2 id="is-h" className="mt-3 font-display text-[34px] leading-[1.1] md:text-[44px]">{copy.isTitle}</h2>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed">{copy.isNot}</p>
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-slate">{feeReason(cfg?.betaFree)}</p>
            <ul className="mt-6 flex flex-col gap-2 text-[15px] text-slate">
              {cfg?.betaFree && <li><b className="text-verified">{copy.menFree}</b></li>}
              <li>Women never need requests. They only reply.</li>
              <li>{copy.chatFree}</li>
            </ul>
          </Reveal>
        </section>

        <section className={section} aria-labelledby="comfort-h">
          <SectionHead eyebrowText={copy.comfortEyebrow} title={copy.comfortTitle} id="comfort-h" />
          <Stagger as="ul" className="mt-8 divide-y divide-stone-200 border-y border-stone-200">
            {copy.comfort.map(([t, b]) => (
              <StaggerItem as="li" key={t} className="grid gap-1 py-6 md:grid-cols-[1fr_1.2fr] md:gap-10 md:py-8">
                <h3 className="font-display text-[26px] leading-tight md:text-[30px]">{t}</h3>
                <p className="self-center text-base leading-relaxed text-slate">{b}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </section>

        <section className={section} aria-labelledby="for-h">
          <SectionHead eyebrowText={copy.forEyebrow} title={copy.forTitle} id="for-h" />
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            {[copy.forWomen, copy.forMen].map(([h, items], i) => (
              <Reveal key={h as string} delay={i * 0.1} className="rounded-[28px] border border-stone-200 bg-white p-8">
                <h3 className="font-display text-[26px]">{h as string}</h3>
                <ul className="mt-5 flex flex-col gap-3 text-[15px]">
                  {(items as string[]).map((it) => (
                    <li key={it} className="flex items-start gap-3"><span aria-hidden="true" className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-ember" />{it}</li>
                  ))}
                </ul>
              </Reveal>
            ))}
          </div>
        </section>

        <Pull>{copy.pull2}</Pull>

        <section className={section} aria-labelledby="safe-h">
          <SectionHead eyebrowText={copy.eyebrows.safe} title={copy.safetyTitle} id="safe-h" />
          <Stagger as="ul" className="mt-10 grid gap-8 md:grid-cols-3 md:gap-6">
            {copy.safety.map(([t, b]) => (
              <StaggerItem as="li" key={t} className="flex flex-col gap-2 border-t border-ink pt-4">
                <h3 className="font-display text-2xl">{t}</h3>
                <p className="text-[15px] leading-relaxed text-slate">{b}</p>
              </StaggerItem>
            ))}
          </Stagger>
          <Reveal className="mt-12 rounded-[28px] bg-mist p-8">
            <h3 className="font-display text-[24px]">{copy.safeDetailTitle}</h3>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              {copy.safeDetail.map(([t, b]) => <div key={t}><dt className="font-semibold">{t}</dt><dd className="text-[15px] text-slate">{b}</dd></div>)}
            </dl>
          </Reveal>
        </section>

        <Pull>{copy.pull3}</Pull>

        <section className="mx-auto w-full max-w-3xl px-5 py-20" aria-labelledby="faq-h">
          <SectionHead eyebrowText={copy.eyebrows.faq} title={copy.faqTitle} id="faq-h" />
          <div className="mt-8 divide-y divide-stone-200 border-y border-stone-200">
            {copy.faq.filter(([q]) => inviteOnly || !q.includes('invite only')).map(([q, raw]) => {
              const a = raw === 'FEE_REASON' ? `${feeReason(cfg?.betaFree)} Chat is free once a request is accepted.`
                : raw === 'CITIES' ? (cfg?.betaCity ? `We are starting in ${cfg.betaCity}.` : copy.citiesDefault)
                : raw === 'BETA_REQUESTS' ? (cfg?.betaFree ? 'During the closed beta, requests are free for men. Later, men buy packs: 10 requests for ₹499 or 20 for ₹899.' : 'Men buy packs: 10 requests for ₹499 or 20 for ₹899.')
                : raw
              return (
                <details key={q} className="group py-1">
                  <summary className="flex min-h-[56px] cursor-pointer items-center justify-between gap-4 py-3 text-[17px] font-medium">
                    {q}
                    <span aria-hidden="true" className="faq-plus flex h-8 w-8 flex-none items-center justify-center rounded-full bg-mist text-lg leading-none">+</span>
                  </summary>
                  <p className="pb-4 pr-12 text-[15px] leading-relaxed text-slate">{a}</p>
                </details>
              )
            })}
          </div>
        </section>

        <section id="join" className="mx-auto w-full max-w-5xl px-5 pb-28 pt-6" aria-labelledby="join-h">
          <Reveal className="rounded-[36px] bg-ink px-6 py-16 text-center text-paper md:px-16 md:py-24">
            <LogoMark size={48} className="mx-auto" door="var(--color-paper)" />
            <h2 id="join-h" className="mx-auto mt-6 max-w-xl font-display text-[38px] leading-[1.08] md:text-[52px]">{inviteOnly ? copy.inviteTitle : copy.openTitle}</h2>
            <p className="mx-auto mt-4 max-w-md text-paper/75">{inviteOnly ? copy.inviteBody : copy.openBody}</p>
            <div className="mt-8 flex justify-center">
              <Link to="/signup" className="inline-flex h-[54px] items-center justify-center rounded-full bg-ember px-8 text-base font-semibold text-ink transition duration-200 hover:brightness-95 active:scale-[0.98]">
                {inviteOnly ? copy.joinInvite : copy.createAccount}
              </Link>
            </div>
            {inviteOnly && <div className="mx-auto mt-10 max-w-md text-left text-ink"><Waitlist /></div>}
            <SupportContact className="mt-8 text-paper/70" />
          </Reveal>
        </section>
      </main>
      <footer className="mx-auto flex w-full max-w-5xl flex-wrap gap-x-6 gap-y-2 px-5 pb-24 text-sm text-slate md:pb-10">
        <Link className="transition-colors hover:text-ink hover:underline" to="/safety">Staying safe</Link>
        <Link className="transition-colors hover:text-ink hover:underline" to="/values">Community values</Link>
        <Link className="transition-colors hover:text-ink hover:underline" to="/legal/terms">Terms</Link>
        <Link className="transition-colors hover:text-ink hover:underline" to="/legal/privacy">Privacy</Link>
        <SupportContact />
        <GrievanceContact />
      </footer>
      {stickyOn && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200 bg-paper/90 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md md:hidden">
          <Link to="/signup" className={`${btnPrimary} w-full`}>{joinLabel}</Link>
        </div>
      )}
    </div>
  )
}
