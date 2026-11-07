// Push-only service worker. Offline support and asset caching are out of scope: there is no fetch handler.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// Only same-origin relative paths are honoured; anything else falls back to the app root.
function safeTarget(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/'
  try {
    const url = new URL(value, self.location.origin)
    return url.origin === self.location.origin ? url.pathname + url.search + url.hash : '/'
  } catch {
    return '/'
  }
}

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    // Not JSON: fall back to the generic text below.
  }
  const text = (v, fallback, max) => (typeof v === 'string' && v.trim() ? v.slice(0, max) : fallback)
  const data = payload && typeof payload.data === 'object' && payload.data !== null ? payload.data : {}
  event.waitUntil(
    self.registration.showNotification(text(payload.title, 'Connectly', 100), {
      body: text(payload.body, 'You have a new notification', 200),
      icon: '/icon.svg',
      data: { url: safeTarget(data.url) },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = safeTarget(event.notification.data && event.notification.data.url)
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const existing = windows.find((w) => new URL(w.url).origin === self.location.origin)
      if (existing) {
        try {
          await existing.focus()
          await existing.navigate(target)
          return
        } catch {
          // The client cannot be navigated (or is gone): open a fresh window instead.
        }
      }
      await self.clients.openWindow(target)
    })(),
  )
})
