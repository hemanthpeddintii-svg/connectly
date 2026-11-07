import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useMeQuery, useReceivedRequestsQuery } from '../api'
import CreditsChip from './CreditsChip'
import { ArchIcon, ChatIcon, InboxIcon, UserIcon, Wordmark } from './icons'

type Tab = { to: string; label: string; icon: ReactNode; active: (path: string) => boolean; count?: number }

function useTabs(): Tab[] {
  const { data: me } = useMeQuery()
  const woman = me?.gender === 'woman'
  const verified = me?.status === 'active'
  // Only a verified woman has an inbox to count; everyone else skips the request.
  const { data: pending } = useReceivedRequestsQuery(undefined, { skip: !(woman && verified) })
  const chats: Tab = { to: '/connections', label: 'Chats', icon: <ChatIcon />, active: (p) => p.startsWith('/connections') || p === '/sent' }
  const me_: Tab = { to: '/me', label: 'Me', icon: <UserIcon />, active: (p) => p === '/me' || p === '/settings' }
  if (!verified) return [{ to: '/verify', label: 'Verify', icon: <ArchIcon />, active: (p) => p === '/verify' }, me_]
  if (woman) return [{ to: '/requests', label: 'Requests', icon: <InboxIcon />, active: (p) => p === '/requests', count: pending?.length }, chats, me_]
  return [{ to: '/wall', label: 'Community', icon: <ArchIcon />, active: (p) => p === '/wall' }, chats, me_]
}

/** Bottom tab bar on small screens. The active tab carries the small dark arch. */
export function TabBar() {
  const { pathname } = useLocation()
  const tabs = useTabs()
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-paper pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul className="mx-auto flex max-w-2xl">
        {tabs.map((t) => {
          const on = t.active(pathname)
          return (
            <li key={t.to} className="flex-1">
              <Link to={t.to} aria-current={on ? 'page' : undefined}
                className={`relative flex h-[68px] flex-col items-center justify-center gap-1 text-xs ${on ? 'font-semibold text-ink' : 'font-medium text-slate'}`}>
                {on && <span aria-hidden="true" className="absolute top-0 h-3.5 w-8 rounded-t-2xl bg-ink" />}
                <span className="relative">
                  {t.icon}
                  {!!t.count && (
                    <span role="img" aria-label={`${t.count} waiting`}
                      className="absolute -right-3 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-ember px-1 text-[11px] font-bold text-ink">{t.count}</span>
                  )}
                </span>
                {t.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** Header for wider screens: the wordmark, the same destinations as the tab bar, and the request balance. */
export function TopBar() {
  const { pathname } = useLocation()
  const { data: me } = useMeQuery()
  const tabs = useTabs()
  return (
    <header className="hidden h-16 items-center justify-between gap-4 border-b border-stone-200 px-5 md:flex">
      <Link to="/" aria-label="connectly home"><Wordmark /></Link>
      <nav aria-label="Main">
        <ul className="flex items-center gap-1">
          {tabs.map((t) => {
            const on = t.active(pathname)
            return (
              <li key={t.to}>
                <Link to={t.to} aria-current={on ? 'page' : undefined}
                  className={`flex h-11 items-center gap-2 rounded-full px-4 text-sm ${on ? 'bg-ink font-semibold text-paper' : 'font-medium text-slate hover:bg-mist'}`}>
                  {t.label}
                  {!!t.count && <span aria-label={`${t.count} waiting`} className="rounded-full bg-ember px-1.5 text-xs font-bold text-ink">{t.count}</span>}
                </Link>
              </li>
            )
          })}
          {me?.role === 'admin' && (
            <li><Link to="/admin" aria-current={pathname === '/admin' ? 'page' : undefined}
              className="flex h-11 items-center rounded-full px-4 text-sm font-medium text-slate hover:bg-mist">Admin</Link></li>
          )}
        </ul>
      </nav>
      <div className="flex min-w-[8rem] justify-end">{me?.gender === 'man' && me.status === 'active' && <CreditsChip credits={me.requestCredits} />}</div>
    </header>
  )
}
