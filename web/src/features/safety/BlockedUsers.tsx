import { useBlocksQuery, useUnblockMemberMutation } from './api'
import { btnOutline, btnSmall, card } from '../../ui'

export default function BlockedUsers() {
  const { data, isLoading, isError, refetch } = useBlocksQuery()
  const [unblock, { isLoading: unblocking, isError: unblockFailed }] = useUnblockMemberMutation()
  return (
    <section aria-labelledby="blocked-heading" className="flex flex-col gap-3">
      <h2 id="blocked-heading" className="font-display text-2xl">Blocked members</h2>
      {isLoading && <p className="text-sm text-slate">Loading…</p>}
      {isError && <p className="text-sm text-slate">Couldn't load blocked members. <button className="font-medium text-ink underline underline-offset-4" onClick={refetch}>Retry</button></p>}
      {data?.length === 0 && <p className="text-sm text-slate">You haven't blocked anyone.</p>}
      {unblockFailed && <p role="alert" className="rounded-xl bg-ember/10 px-4 py-3 text-sm text-ember-deep">Could not unblock. Please try again.</p>}
      {data && data.length > 0 && (
        <ul className={`${card} divide-y divide-stone-200 !p-0`}>
          {data.map((m) => (
            <li key={m.memberId} className="flex items-center justify-between gap-3 px-5 py-3.5 text-[15px]">
              <span>{m.name}, {m.age}</span>
              <button disabled={unblocking} onClick={() => unblock(m.memberId)} aria-label={`Unblock ${m.name}`}
                className={`${btnOutline} ${btnSmall}`}>Unblock</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
