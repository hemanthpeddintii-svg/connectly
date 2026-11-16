import { Link } from 'react-router-dom'
import { useAgreeTermsMutation, useMeQuery } from '../../api'
import { btnPrimary } from '../../ui'
import { LogoMark } from '../../components/icons'
import { PageFade } from '../../components/motion'

/** Blocks accounts created before terms existed until they agree. Returns null when nothing is needed. */
export default function TermsGate() {
  const { data: me } = useMeQuery()
  const [agree, { isLoading, isError }] = useAgreeTermsMutation()
  if (!me || me.termsAgreed) return null
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="terms-title" className="fixed inset-0 z-50 flex items-center justify-center bg-paper px-5">
      <PageFade className="flex w-full max-w-md flex-col gap-5">
        <LogoMark size={44} />
        <h1 id="terms-title" className="font-display text-[34px] leading-[1.1]">One quick thing</h1>
        <p className="text-[15px] leading-relaxed text-slate">
          Our terms, privacy policy or community values have been added or updated. Please read them and confirm you are 18 or over to carry on.
        </p>
        <p className="text-sm"><Link className="font-medium underline underline-offset-4" to="/values" target="_blank" rel="noopener noreferrer">Community values</Link> · <Link className="font-medium underline underline-offset-4" to="/legal/terms" target="_blank" rel="noopener noreferrer">Terms</Link> · <Link className="font-medium underline underline-offset-4" to="/legal/privacy" target="_blank" rel="noopener noreferrer">Privacy</Link></p>
        {isError && <p role="alert" className="rounded-xl bg-ember/10 px-4 py-3 text-sm text-ember-deep">Could not save that. Please try again.</p>}
        <button type="button" disabled={isLoading} onClick={() => void agree()} className={btnPrimary}>
          {isLoading ? 'Saving…' : 'Agree to continue'}
        </button>
      </PageFade>
    </div>
  )
}
