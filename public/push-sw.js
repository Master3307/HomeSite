/*
 * Push notifications in the browser (src/lib/push.js registers this worker
 * only once someone turns push on in Settings → Notifications).
 * It does nothing else: no caching, no offline copies, every page still
 * comes straight from the server.
 */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: event.data ? event.data.text() : '' }
  }
  const title = String(data.title || 'HomeSite').slice(0, 200)
  const link = typeof data.link === 'string' && data.link.startsWith('/') ? data.link : '/cult/notifications'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: String(data.body || '').slice(0, 500),
      icon: '/android-chrome-192x192.png',
      badge: '/img/notification-badge.png',
      tag: data.tag || undefined,
      data: { link },
    }),
  )
})

// A click opens what the notification is about: in an open tab of the site if there is one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.link || '/', self.location.origin).href
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue
        await client.focus()
        if ('navigate' in client) await client.navigate(target).catch(() => {})
        return
      }
      await self.clients.openWindow(target)
    })(),
  )
})
