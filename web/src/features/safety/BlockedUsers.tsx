import { useBlocksQuery, useUnblockMemberMutation } from './api'

export default function BlockedUsers() {
  const { data, isLoading, isError, refetch } = useBlocksQuery()
  const [unblock, { isLoading: unblocking, isError: unblockFailed }] = useUnblockMemberMutation()
  return (
    <section aria-labelledby="blocked-heading" className="flex flex-col gap-2">
      <h2 id="blocked-heading" className="text-lg font-semibold">Blocked members</h2>
      {isLoading && <p className="text-stone-500">Loading…</p>}
      {isError && <p>Couldn't load blocked members. <button className="underline" onClick={refetch}>Retry</button></p>}
      {data?.length === 0 && <p className="text-sm text-stone-500">You haven't blocked anyone.</p>}
      {unblockFailed && <p role="alert" className="text-sm text-red-600">Could not unblock. Please try again.</p>}
      {data && data.length > 0 && (
        <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
          {data.map((m) => (
            <li key={m.memberId} className="flex items-center justify-between gap-3 px-4 py-3">
              <span>{m.name}, {m.age}</span>
              <button disabled={unblocking} onClick={() => unblock(m.memberId)} aria-label={`Unblock ${m.name}`}
                className="rounded-md border border-stone-300 px-3 py-1.5 text-sm disabled:opacity-50">Unblock</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
