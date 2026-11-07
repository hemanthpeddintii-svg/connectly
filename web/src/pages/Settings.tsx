import { Link, useNavigate } from 'react-router-dom'
import { useDispatch } from 'react-redux'
import { api, authSlice } from '../api'
import { unsubscribeThisDevice } from '../features/push/unsubscribe'
import Preferences from '../features/preferences/Preferences'
import Account from '../features/account/Account'
import BlockedUsers from '../features/safety/BlockedUsers'
import SecuritySettings from './SecuritySettings'
import PageHeader from '../components/PageHeader'
import { ChevronIcon } from '../components/icons'
import TermsGate from '../features/onboarding/TermsGate'

const row = 'flex min-h-14 items-center justify-between rounded-[22px] bg-white px-5 text-[15px] font-semibold'
const head = 'pt-2 text-xs font-semibold uppercase tracking-[0.08em] text-ember-deep'

function Row({ to, label, sub, anchor }: { to: string; label: string; sub?: string; anchor?: boolean }) {
  const inner = <><span>{label}{sub && <span className="block text-[13px] font-normal text-slate">{sub}</span>}</span><ChevronIcon size={20} /></>
  return <li>{anchor ? <a href={to} className={row}>{inner}</a> : <Link to={to} className={row}>{inner}</Link>}</li>
}

export default function Settings() {
  const dispatch = useDispatch()
  const nav = useNavigate()
  function logout() {
    const token = localStorage.getItem('token')
    if (token) void unsubscribeThisDevice(token)
    dispatch(authSlice.actions.setToken(null))
    dispatch(api.util.resetApiState())
    nav('/login', { replace: true })
  }
  return (
    <div className="flex flex-col gap-3 pb-6">
      <TermsGate />
      <PageHeader title="Settings" back="/me" backLabel="Back to my profile" />
      <h2 className={head}>Your community</h2>
      <ul className="flex flex-col gap-2">
        <Row anchor to="#wall-filters" label="Wall filters" sub="Age and interests" />
        <Row to="/settings/notifications" label="Notifications" />
        <Row anchor to="#account" label="Quiet mode" />
        <Row anchor to="#blocked" label="Blocked members" />
      </ul>
      <h2 className={head}>Your account</h2>
      <ul className="flex flex-col gap-2">
        <Row anchor to="#security" label="Security" />
        <Row anchor to="#account" label="Account" sub="Deactivate or delete" />
      </ul>
      <h2 className={head}>About Connectly</h2>
      <ul className="flex flex-col gap-2">
        <Row to="/guidelines" label="Community guidelines" />
        <Row to="/help" label="Help and support" />
        <Row to="/legal" label="Terms and privacy" />
      </ul>
      <button type="button" onClick={logout} className="h-12 rounded-full border border-stone-300 text-base font-semibold">Log out</button>
      <div className="mt-4 flex flex-col gap-6">
        <section id="wall-filters" className="scroll-mt-4"><Preferences /></section>
        <section id="blocked" className="scroll-mt-4"><BlockedUsers /></section>
        <section id="security" className="scroll-mt-4"><SecuritySettings /></section>
        <section id="account" className="scroll-mt-4"><Account /></section>
      </div>
    </div>
  )
}
