import { useEffect } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { api, authSlice, useMeQuery } from './api'
import type { RootState } from './store'
import { useRealtime } from './realtime'
import { TabBar, TopBar } from './components/Nav'
import { Loading } from './components/State'
import Auth from './pages/Auth'
import GenderChooser from './pages/GenderChooser'
import Wall from './pages/Wall'
import SendRequest from './pages/SendRequest'
import Requests from './pages/Requests'
import Accepted from './pages/Accepted'
import Sent from './pages/Sent'
import Connections from './pages/Connections'
import Chat from './pages/Chat'
import Profile from './pages/Profile'
import Verify from './pages/Verify'
import Admin from './pages/Admin'
import Membership from './pages/Membership'
import Settings from './pages/Settings'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Welcome from './pages/Welcome'
import Landing from './pages/Landing'
import Values from './pages/Values'
import ProfileSetup from './pages/ProfileSetup'
import Guidelines from './pages/Guidelines'
import Help from './pages/Help'
import Legal from './pages/Legal'
import NotificationSettings from './pages/NotificationSettings'
import TermsGate from './features/onboarding/TermsGate'

// Screens that take over the page: no tab bar, and the chat and "Come in" screens also skip the page padding.
const noTabs = /^\/(request|accepted|membership)(\/|$)|^\/connections\/[^/]+/
const flush = /^\/(accepted|connections\/[^/]+)/

function Shell() {
  const token = useSelector((s: RootState) => s.auth.token)
  const dispatch = useDispatch()
  const { pathname } = useLocation()
  const { data: me, error, refetch } = useMeQuery(undefined, { skip: !token })
  useRealtime()

  // An expired or revoked token comes back as 401, and a purged account reports 'deleted': drop the session.
  useEffect(() => {
    if ((error as { status?: number } | undefined)?.status === 401 || me?.status === 'deleted') {
      dispatch(authSlice.actions.setToken(null))
      dispatch(api.util.resetApiState())
    }
  }, [error, me?.status, dispatch])

  if (!token) return <Navigate to="/" replace />
  if (!me) {
    return error
      ? <p role="alert" className="p-6 text-slate">Couldn't load your account. <button className="underline" onClick={refetch}>Try again</button></p>
      : <Loading />
  }
  if (me.gender === null) return <GenderChooser />

  // The admin console is its own full-width app with a sidebar; it brings its own layout.
  if (pathname.startsWith('/admin')) return <><TermsGate /><Outlet /></>

  // Unverified members can only reach verification, profile setup, their profile, settings and the help pages.
  const openToUnverified = /^\/(verify|setup|me|settings|help|guidelines|legal)(\/|$)/
  if (me.status !== 'active' && !openToUnverified.test(pathname)) return <Navigate to="/verify" replace />

  const tabs = !noTabs.test(pathname)
  const bare = pathname.startsWith('/accepted')
  return (
    <div className="flex min-h-dvh flex-col">
      <TermsGate />
      {!bare &&<div className="mx-auto w-full max-w-2xl"><TopBar /></div>}
      {me.suspended && (
        <div role="status" className="mx-auto mt-3 w-full max-w-2xl px-5">
          <p className="rounded-2xl bg-ember/15 px-4 py-3 text-sm font-medium text-ember-deep">
            Your account is suspended after a report. You can read your chats, but you can't send requests or messages right now.
          </p>
        </div>
      )}
      <main className={`mx-auto flex w-full max-w-2xl flex-1 flex-col ${flush.test(pathname) ? '' : 'px-5 pt-4'} ${tabs ? 'pb-24 md:pb-10' : ''}`}>
        <Outlet />
      </main>
      {tabs && <TabBar />}
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Auth mode="login" />} />
      <Route path="/signup" element={<Auth mode="signup" />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/welcome" element={<Welcome />} />
      <Route path="/values" element={<Values />} />
      <Route path="/legal" element={<Legal />} />
      <Route path="/legal/:doc" element={<Legal />} />
      <Route element={<Shell />}>
        <Route path="/setup" element={<ProfileSetup />} />
        <Route path="/guidelines" element={<Guidelines />} />
        <Route path="/help" element={<Help />} />
        <Route path="/settings/notifications" element={<NotificationSettings />} />
        <Route path="/verify" element={<Verify />} />
        <Route path="/wall" element={<Wall />} />
        <Route path="/request/:memberId" element={<SendRequest />} />
        <Route path="/requests" element={<Requests />} />
        <Route path="/accepted/:connectionId" element={<Accepted />} />
        <Route path="/sent" element={<Sent />} />
        <Route path="/connections" element={<Connections />} />
        <Route path="/connections/:id" element={<Chat />} />
        <Route path="/membership" element={<Membership />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/me" element={<Profile />} />
        <Route path="/admin/*" element={<Admin />} />
        <Route path="*" element={<Navigate to="/wall" replace />} />
      </Route>
    </Routes>
  )
}
