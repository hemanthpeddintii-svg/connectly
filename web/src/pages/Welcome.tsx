import { Navigate } from 'react-router-dom'

/** The old welcome screen now lives at the home page. */
export default function Welcome() {
  return <Navigate to="/" replace />
}
