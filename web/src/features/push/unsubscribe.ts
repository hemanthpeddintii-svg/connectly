/**
 * Called on logout: removes this browser's push subscription from the server and the browser, so a
 * signed-out device stops receiving the member's notifications. Best effort; never blocks logout.
 */
export async function unsubscribeThisDevice(token: string | null) {
  try {
    if (!token || !('serviceWorker' in navigator)) return
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (!sub) return
    await fetch('/v0/push/subscriptions', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    })
    await sub.unsubscribe()
  } catch { /* push cleanup must not break logout */ }
}
