// This file is static and cannot read the tenant config, so nothing in it may
// name a client. Caches are scoped per origin and every tenant is its own
// domain, so a plain name is already unique.
const CACHE_NAME = 'driver-v4'

// Icons are deliberately NOT precached: their filenames depend on the tenant's
// NEXT_PUBLIC_CLIENT_ICON_PREFIX, and addAll() rejects the whole install if any
// single entry 404s. They are picked up by the cache-first handler below.
const APP_SHELL = ['/driver', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      ),
    ])
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  if (request.method !== 'GET') return

  const url = new URL(request.url)

  if (url.origin !== self.location.origin) return

  // Never intercept Next.js build assets — they're content-hashed and a
  // cached copy from a previous deploy breaks the page (version skew).
  if (url.pathname.startsWith('/_next/')) return

  // Pages: network-first so every deploy shows up immediately.
  // Cache is only a fallback for offline use (driver app in the field).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('/driver'))
        )
    )
    return
  }

  // Small static assets (icons, manifest): cache-first is safe.
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(() => cached)

      return cached || networkFetch
    })
  )
})

self.addEventListener('push', (event) => {
  let data = {}

  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {
      body: event.data ? event.data.text() : 'You have a new update.',
    }
  }

  // The server always sends a branded title and the tenant's icon; these
  // fallbacks exist only for a malformed payload and must stay generic.
  const title = data.title || 'Driver'
  const body = data.body || 'You have a new update.'
  const url = data.url || '/driver'
  const icon = data.icon || '/icons/icon-192.png'

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge: icon,
      data: { url },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl = event.notification?.data?.url || '/driver'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(targetUrl)
          return client.focus()
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(targetUrl)
      }

      return Promise.resolve()
    })
  )
})