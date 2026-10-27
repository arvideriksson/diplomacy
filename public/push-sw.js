// Push handling, pulled into the generated service worker via workbox `importScripts`
// (vite.config.ts). Payloads come from public.push_notify: { title, body, url, tag }.

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}
  event.waitUntil(
    (async () => {
      // Already looking at that game: the app shows it live, so stay quiet.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const watching = windows.some(
        (c) => c.focused && c.visibilityState === 'visible' && new URL(c.url).pathname === data.url,
      )
      if (watching) return
      await self.registration.showNotification(data.title ?? 'Diplomacy', {
        body: data.body,
        tag: data.tag,
        renotify: !!data.tag,
        icon: '/pwa/icon-192.png',
        badge: '/pwa/icon-192.png',
        data: { url: data.url ?? '/' },
      })
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/'
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const open = windows.find((c) => new URL(c.url).pathname === url) ?? windows[0]
      if (open) {
        await open.focus()
        if (new URL(open.url).pathname !== url) await open.navigate(url)
        return
      }
      await self.clients.openWindow(url)
    })(),
  )
})
