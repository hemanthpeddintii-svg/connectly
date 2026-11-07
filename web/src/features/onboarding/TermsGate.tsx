import { Link } from 'react-router-dom'
import { useAgreeTermsMutation, useMeQuery } from '../../api'
import { btnPrimary } from '../../ui'
import { LogoMark } from '../../components/icons'

/** Blocks accounts created before terms existed until they agree. Returns null when nothing is needed. */
export default function TermsGate() {
  const { data: me } = useMeQuery()
  const [agree, { isLoading, isError }] = useAgreeTermsMutation()
  if (!me || me.termsAgreed) return null
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="terms-title" className="fixed inset-0 z-50 flex items-center justify-center bg-paper px-5">
      <div className="flex w-full max-w-md flex-col gap-4">
        <LogoMark size={44} />
        <h1 id="terms-title" className="font-display text-[28px] font-semibold leading-tight">One quick thing</h1>
        <p className="text-[15px] text-slate">
          We have added community values and terms. Please read them and confirm you are 18 or over to carry on.
        </p>
        <p className="text-sm"><Link className="font-semibold underline" to="/values">Community values</Link> · <Link className="font-semibold underline" to="/legal/terms">Terms</Link></p>
        {isError && <p role="alert" className="text-sm text-ember-deep">Could not save that. Please try again.</p>}
        <button type="button" disabled={isLoading} onClick={() => void agree()} className={btnPrimary}>
          {isLoading ? 'Saving…' : 'Agree to continue'}
        </button>
      </div>
    </div>
  )
}
