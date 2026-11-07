import { useEffect, useState } from 'react'
import { api } from '../api'
import PageHeader from '../components/PageHeader'
import { ErrorState, Loading } from '../components/State'
import PushToggle from '../features/push/PushToggle'

const notificationsApi = api.injectEndpoints({
  endpoints: (b) => ({
    notificationPrefs: b.query<{ emailRequests: boolean }, void>({ query: () => 'notifications' }),
    saveNotificationPrefs: b.mutation<{ emailRequests: boolean }, { emailRequests: boolean }>({
      query: (body) => ({ url: 'notifications', method: 'PUT', body }),
      async onQueryStarted(arg, { dispatch, queryFulfilled }) {
        const patch = dispatch(notificationsApi.util.updateQueryData('notificationPrefs', undefined, (d) => { d.emailRequests = arg.emailRequests }))
        try { await queryFulfilled } catch { patch.undo() }
      },
    }),
  }),
})
const { useNotificationPrefsQuery, useSaveNotificationPrefsMutation } = notificationsApi

export default function NotificationSettings() {
  const { data, isLoading, isError, refetch } = useNotificationPrefsQuery()
  const [save, { isLoading: saving }] = useSaveNotificationPrefsMutation()
  const [error, setError] = useState('')
  useEffect(() => { if (data) setError('') }, [data])
  const on = data?.emailRequests ?? false

  async function toggle() {
    setError('')
    try { await save({ emailRequests: !on }).unwrap() } catch { setError('Could not save. Try again.') }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Notifications" back="/settings" backLabel="Back to settings" />
      <p className="text-[15px] leading-relaxed text-slate">
        We tell you when something needs you. Notifications never show names or messages, so they are safe on a lock screen.
      </p>
      <section aria-labelledby="email-title" className="flex flex-col gap-3 rounded-3xl bg-white p-5">
        <h2 id="email-title" className="font-display text-lg font-semibold">Email</h2>
        {isLoading ? <Loading /> : isError ? <ErrorState what="your notification settings" onRetry={refetch} /> : (
          <>
            <div className="flex items-center justify-between gap-3">
              <span id="email-label" className="text-[15px]">Email me about requests</span>
              <button type="button" role="switch" aria-checked={on} aria-labelledby="email-label" aria-describedby="email-help"
                disabled={saving} onClick={() => void toggle()}
                className="flex min-h-11 items-center gap-2 disabled:opacity-50">
                <span className="w-8 text-sm font-semibold">{on ? 'On' : 'Off'}</span>
                <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-ink' : 'bg-stone-300'}`}>
                  <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : ''}`} />
                </span>
              </button>
            </div>
            <p id="email-help" className="text-sm text-slate">
              {on ? 'You will get an email when someone sends you a request or accepts yours, only if you are not online.' : 'No emails. You can still see everything inside Connectly.'}
            </p>
            {error && <p role="alert" className="text-sm text-ember-deep">{error}</p>}
          </>
        )}
      </section>
      <div className="rounded-3xl bg-white p-5"><PushToggle /></div>
    </div>
  )
}
