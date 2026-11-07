import { Link } from 'react-router-dom'
import { useConnectionsQuery } from '../api'
import SafetyMenu from '../features/safety/SafetyMenu'

export default function Connections() {
  const { data, isLoading } = useConnectionsQuery()
  if (isLoading) return <p className="text-stone-500">Loading…</p>
  if (!data?.length) return <p className="text-stone-500">No connections yet. Like someone on the wall.</p>
  return (
    <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
      {data.map((c) => (
        <li key={c.id} className="flex items-center">
          <Link to={`/connections/${c.id}`} className="block flex-1 px-4 py-3 hover:bg-stone-50">
            <span className="font-medium">{c.profile.name}</span>
            <span className="ml-2 text-sm text-stone-500">{c.profile.age}</span>
          </Link>
          <div className="px-3"><SafetyMenu bumpId={c.profile.bumpId} /></div>
        </li>
      ))}
    </ul>
  )
}
