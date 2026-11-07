import { useEffect } from 'react'
import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { api, authSlice, useMeQuery } from './api'
import type { RootState } from './store'
import { useRealtime } from './realtime'
import Auth from './pages/Auth'
import Wall from './pages/Wall'
import Connections from './pages/Connections'
import Chat from './pages/Chat'
import Profile from './pages/Profile'
import Verify from './pages/Verify'
import Admin from './pages/Admin'
import Membership from './pages/Membership'
import Settings from './pages/Settings'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import { unsubscribeThisDevice } from './features/push/unsubscribe'

function Shell() {
  const token = useSelector((s: RootState) => s.auth.token)
  const dispatch = useDispatch()
  const { pathname } = useLocation()
  const { data: me, error } = useMeQuery(undefined, { skip: !token })
  useRealtime()

  // An expired or revoked token comes back as 401, and a purged account reports 'deleted': drop the session.
  useEffect(() => {
    if ((error as { status?: number } | undefined)?.status === 401 || me?.status === 'deleted') {
      dispatch(authSlice.actions.setToken(null))
      dispatch(api.util.resetApiState())
    }
  }, [error, me?.status, dispatch])

  if (!token) return <Navigate to="/login" replace />
  if (!me) return <p className="p-6 text-stone-500">Loading…</p>

  const active = me.status === 'active'
  // Unverified members can only reach the verification and profile pages.
  if (!active && pathname !== '/verify' && pathname !== '/me' && pathname !== '/settings') return <Navigate to="/verify" replace />

  const tab = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded-md text-sm font-medium ${isActive ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-200'}`
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
        <span className="text-lg font-semibold">Connectly</span>
        <nav className="flex gap-1">
          {active ? (
            <>
              <NavLink to="/wall" className={tab}>Wall</NavLink>
              <NavLink to="/connections" className={tab}>Connections</NavLink>
              <NavLink to="/membership" className={tab}>Membership</NavLink>
            </>
          ) : (
            <NavLink to="/verify" className={tab}>Verify</NavLink>
          )}
          <NavLink to="/me" className={tab}>Me</NavLink>
          <NavLink to="/settings" className={tab}>Settings</NavLink>
          {me.role === 'admin' && <NavLink to="/admin" className={tab}>Admin</NavLink>}
        </nav>
        <button
          className="text-sm text-stone-500 hover:text-stone-900"
          onClick={() => { void unsubscribeThisDevice(token); dispatch(authSlice.actions.setToken(null)); dispatch(api.util.resetApiState()) }}
        >Log out</button>
      </header>
      <main className="flex-1 p-4"><Outlet /></main>
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
