import { Suspense, lazy } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Loading } from './components/State'
import Auth from './pages/Auth'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Welcome from './pages/Welcome'
import Landing from './pages/Landing'
import Values from './pages/Values'
import Legal from './pages/Legal'
import Safety from './pages/Safety'

// Everything behind sign-in loads on demand, so the landing page stays light.
const MemberApp = lazy(() => import('./MemberApp'))

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
      <Route path="/safety" element={<Safety />} />
      <Route path="/legal" element={<Legal />} />
      <Route path="/legal/:doc" element={<Legal />} />
      <Route path="/*" element={<Suspense fallback={<Loading />}><MemberApp /></Suspense>} />
    </Routes>
  )
}
