import { Link } from 'react-router-dom'
import { useActMutation, useWallQuery } from '../api'
import SafetyMenu from '../features/safety/SafetyMenu'

export default function Wall() {
  const { data, isLoading, isError, refetch } = useWallQuery()
  const [act, { data: result, isLoading: acting }] = useActMutation()
  if (isLoading) return <p className="text-stone-500">Loading…</p>
  if (isError) return <p>Couldn't load profiles. <button className="underline" onClick={refetch}>Retry</button></p>
  const p = data?.[0]
  return (
    <div className="flex flex-col gap-4">
      {result?.matched && (
        <div role="status" className="rounded-md bg-emerald-100 p-3 text-emerald-900">
          It's a match! <Link className="underline" to={`/connections/${result.connectionId}`}>Say hi</Link>
        </div>
      )}
      {!p ? (
        <p className="text-stone-500">You're all caught up. Check back soon.</p>
      ) : (
        <article className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-xl font-semibold">{p.name}, {p.age}</h2>
            <SafetyMenu bumpId={p.bumpId} />
          </div>
          {p.bio && <p className="mt-2 text-stone-700">{p.bio}</p>}
          {p.interests.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {p.interests.map((i) => <li key={i} className="rounded-full bg-stone-100 px-3 py-1 text-sm">{i}</li>)}
            </ul>
          )}
          <div className="mt-5 flex gap-3">
            <button disabled={acting} onClick={() => act({ bumpId: p.bumpId, action: 'skip' })}
              className="flex-1 rounded-md border border-stone-300 px-3 py-2 disabled:opacity-50">Skip</button>
            <button disabled={acting} onClick={() => act({ bumpId: p.bumpId, action: 'like' })}
              className="flex-1 rounded-md bg-stone-900 px-3 py-2 text-white disabled:opacity-50">Like</button>
          </div>
        </article>
      )}
    </div>
  )
}
