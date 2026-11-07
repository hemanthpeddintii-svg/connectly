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

  if (!token) return <Navigate to="/login" replace />
  if (!me) {
    return error
      ? <p role="alert" className="p-6 text-slate">Couldn't load your account. <button className="underline" onClick={refetch}>Try again</button></p>
      : <Loading />
  }
  if (me.gender === null) return <GenderChooser />

  // Unverified members can only reach the verification, profile and settings pages.
  if (me.status !== 'active' && pathname !== '/verify' && pathname !== '/me' && pathname !== '/settings') return <Navigate to="/verify" replace />

  const tabs = !noTabs.test(pathname)
  const bare = pathname.startsWith('/accepted')
  return (
    <div className="flex min-h-dvh flex-col">
      {!bare && <div className="mx-auto w-full max-w-2xl"><TopBar /></div>}
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
      <Route path="/login" element={<Auth mode="login" />} />
      <Route path="/signup" element={<Auth mode="signup" />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<Shell />}>
        <Route path="/verify" element={<Verify />} />
        <Route path="/wall" element={<Wall />} />
        <Route path="/request/:bumpId" element={<SendRequest />} />
        <Route path="/requests" element={<Requests />} />
        <Route path="/accepted/:connectionId" element={<Accepted />} />
        <Route path="/sent" element={<Sent />} />
        <Route path="/connections" element={<Connections />} />
        <Route path="/connections/:id" element={<Chat />} />
        <Route path="/membership" element={<Membership />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/me" element={<Profile />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Navigate to="/wall" replace />} />
      </Route>
    </Routes>
  )
}
