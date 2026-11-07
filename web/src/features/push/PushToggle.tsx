import { useEffect, useState } from 'react'
import { usePushConfigQuery, useSubscribePushMutation, useUnsubscribePushMutation, type PushSubscriptionBody } from './api'

const READY_TIMEOUT_MS = 5000

const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

const toBase64Url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** `serviceWorker.ready` never settles when nothing is registered, so bound the wait. */
function swReady(): Promise<ServiceWorkerRegistration> {
  let timer: number
  const timeout = new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error('service worker unavailable')), READY_TIMEOUT_MS) })
  return Promise.race([navigator.serviceWorker.ready, timeout]).finally(() => window.clearTimeout(timer))
}

/** The browser's existing subscription, unless it was made for a different server key (then it is dropped). */
async function currentSubscription(reg: ServiceWorkerRegistration, serverKey: string): Promise<PushSubscription | null> {
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return null
  const key = sub.options.applicationServerKey
  if (key && toBase64Url(key) === serverKey) return sub
  await sub.unsubscribe()
  return null
}

function toBody(sub: PushSubscription): PushSubscriptionBody {
  const { endpoint, keys } = sub.toJSON()
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error('incomplete subscription')
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }
}

export default function PushToggle() {
  // Dev builds register no service worker (see main.tsx), so push can only work in production builds.
  const production = import.meta.env.PROD
  const { data: config, isLoading, isError, refetch } = usePushConfigQuery(undefined, { skip: !supported || !production })
  const [subscribe] = useSubscribePushMutation()
  const [unsubscribe] = useUnsubscribePushMutation()
  const [permission, setPermission] = useState<NotificationPermission>(() => (supported ? Notification.permission : 'default'))
  const [on, setOn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const serverKey = config?.enabled ? config.publicKey : null
  const inspect = supported && production && serverKey !== null && permission === 'granted'

  // Reflect the browser's real subscription, and re-bind it to the signed-in account (a shared browser may hold another member's).
  useEffect(() => {
    if (!inspect || serverKey === null) return
    let cancelled = false
    void (async () => {
      try {
        const sub = await currentSubscription(await swReady(), serverKey)
        if (cancelled) return
        setOn(sub !== null)
        if (sub) await subscribe(toBody(sub)).unwrap().catch(() => undefined)
      } catch {
        if (!cancelled) setOn(false)
      }
    })()
    return () => { cancelled = true }
  }, [inspect, serverKey, subscribe])

  async function enable() {
    if (serverKey === null) return
    setBusy(true); setError(null); setNotice(null)
    let created: PushSubscription | null = null
    try {
      const result = await Notification.requestPermission()
      setPermission(result)
      if (result !== 'granted') {
        if (result === 'default') setError('Notification permission was not granted.')
        return
      }
      const reg = await swReady()
      let sub = await currentSubscription(reg, serverKey)
      if (!sub) sub = created = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(serverKey) })
      await subscribe(toBody(sub)).unwrap()
      setOn(true)
    } catch {
      if (created) await created.unsubscribe().catch(() => undefined)
      setError('Could not turn on notifications. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true); setError(null); setNotice(null)
    try {
      const sub = await (await swReady()).pushManager.getSubscription()
      if (sub) {
        await sub.unsubscribe()
        setOn(false)
        await unsubscribe({ endpoint: sub.endpoint }).unwrap().catch(() => {
          setNotice('Notifications are off on this device. The server could not be updated and will clean up automatically.')
        })
      } else {
        setOn(false)
      }
    } catch {
      setError('Could not turn off notifications. Try again.')
    } finally {
      setBusy(false)
    }
  }

  let status: string
  let actionable = false
  if (!supported) status = 'This browser does not support push notifications. On iPhone or iPad, add Connectly to your Home Screen first.'
  else if (!production) status = 'Push notifications need a production build: the service worker is only registered there. Run a production build and serve it to try this.'
  else if (isLoading) status = 'Checking availability…'
  else if (isError) status = 'Could not check whether notifications are available.'
  else if (!config?.enabled) status = 'Push notifications are not enabled on this server.'
  else if (permission === 'denied') status = 'Notifications are blocked for this site. Allow them in your browser’s site settings (usually the icon next to the address bar), then reload this page.'
  else if (permission === 'granted' && on === null) status = 'Checking this device…'
  else {
    actionable = true
    status = permission === 'granted' && on ? 'On for this device.' : 'Off on this device.'
  }
  const isOn = actionable && permission === 'granted' && on === true

  return (
    <section aria-labelledby="push-title" className="flex flex-col gap-3">
      <h2 id="push-title" className="text-lg font-semibold">Push notifications</h2>
      <p className="text-sm text-stone-500">
        Get a heads-up when a message arrives while Connectly is closed. Notifications never show who wrote or what was said.
      </p>
      <div className="flex items-center justify-between gap-3">
        <span id="push-label" className="text-sm">Notify me about new messages</span>
        <button
          type="button"
          role="switch"
          aria-checked={isOn}
          aria-labelledby="push-label"
          aria-describedby="push-status"
          disabled={!actionable || busy}
          onClick={() => void (isOn ? disable() : enable())}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${isOn ? 'bg-stone-900' : 'bg-stone-300'}`}
        >
          <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${isOn ? 'translate-x-5' : ''}`} />
        </button>
      </div>
      <p id="push-status" role="status" className="text-sm text-stone-600">{busy ? 'Working…' : status}</p>
      {isError && supported && production && (
        <button type="button" onClick={() => void refetch()} className="self-start rounded-md border border-stone-300 px-3 py-1.5 text-sm">Try again</button>
      )}
      {notice && <p role="status" className="text-sm text-stone-600">{notice}</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </section>
  )
}
