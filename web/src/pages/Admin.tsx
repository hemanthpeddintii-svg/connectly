import { useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useMeQuery } from '../api'
import { useAdminOverviewQuery } from '../features/admin/api'
import { LogoMark } from '../components/icons'
import { Loading } from '../components/State'
import Overview from './admin/Overview'
import { VerificationQueue, VerificationCase } from './admin/Verifications'
import { PaymentQueue, PaymentCase } from './admin/Payments'
import { ReportQueue, ReportCase } from './admin/Reports'
import { MemberList, MemberDetail } from './admin/Members'
import LaunchPage from './admin/Launch'
import Growth from './admin/Growth'
import Beta from './admin/Beta'
import AdminSettingsPage from './admin/Settings'

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const { data } = useAdminOverviewQuery()
  const items: Array<{ to: string; label: string; count?: number; end?: boolean }> = [
    { to: '/admin', label: 'Launch', end: true },
    { to: '/admin/overview', label: 'Overview' },
    { to: '/admin/verifications', label: 'Verifications', count: data?.verificationsPending },
    { to: '/admin/payments', label: 'Payments', count: data?.paymentsPending },
    { to: '/admin/reports', label: 'Reports', count: data?.reportsOpen },
    { to: '/admin/members', label: 'Members' },
    { to: '/admin/growth', label: 'Growth' },
    { to: '/admin/beta', label: 'Beta' },
    { to: '/admin/settings', label: 'Settings' },
  ]
  return (
    <nav aria-label="Admin" className="flex flex-col gap-1">
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.end} onClick={onNavigate}
          className={({ isActive }) => `flex min-h-11 items-center justify-between rounded-xl px-3.5 text-[15px] font-semibold ${isActive ? 'bg-paper text-ink' : 'text-paper hover:bg-white/10'}`}>
          {i.label}
          {i.count ? <span className="rounded-full bg-ember px-2 py-0.5 text-xs font-bold text-ink">{i.count}<span className="sr-only"> waiting</span></span> : null}
        </NavLink>
      ))}
    </nav>
  )
}

function Brand() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-paper"><LogoMark size={22} /></span>
      <span className="font-display text-base font-semibold text-paper">Connectly <span className="font-normal opacity-70">Admin</span></span>
    </span>
  )
}

export default function Admin() {
  const { data: me } = useMeQuery()
  const [open, setOpen] = useState(false)
  useLocation()
  if (me && me.role !== 'admin') return <Navigate to="/wall" replace />
  if (!me) return <Loading />
  return (
    <div className="min-h-dvh bg-paper text-ink md:flex">
      <header className="sticky top-0 z-20 bg-ink px-4 md:hidden">
        <div className="flex h-14 items-center justify-between">
          <Brand />
          <button type="button" aria-expanded={open} aria-controls="admin-menu" onClick={() => setOpen(!open)}
            className="min-h-11 rounded-full px-4 text-sm font-semibold text-paper">{open ? 'Close' : 'Menu'}</button>
        </div>
        {open && <div id="admin-menu" className="pb-3"><SideNav onNavigate={() => setOpen(false)} /></div>}
      </header>
      <aside className="sticky top-0 hidden h-dvh w-60 flex-none flex-col gap-6 overflow-y-auto bg-ink p-4 md:flex">
        <Brand />
        <SideNav />
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-5xl">
          <Routes>
            <Route index element={<LaunchPage />} />
            <Route path="overview" element={<Overview />} />
            <Route path="growth" element={<Growth />} />
            <Route path="verifications" element={<VerificationQueue />} />
            <Route path="verifications/:id" element={<VerificationCase />} />
            <Route path="payments" element={<PaymentQueue />} />
            <Route path="payments/:id" element={<PaymentCase />} />
            <Route path="reports" element={<ReportQueue />} />
            <Route path="reports/:id" element={<ReportCase />} />
            <Route path="members" element={<MemberList />} />
            <Route path="members/:memberId" element={<MemberDetail />} />
            <Route path="beta" element={<Beta />} />
            <Route path="settings" element={<AdminSettingsPage />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}
