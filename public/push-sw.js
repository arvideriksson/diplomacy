// Push handling, pulled into the generated service worker via workbox `importScripts`
// (vite.config.ts). Payloads come from public.push_notify: { title, body, url, tag }.

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}
  event.waitUntil(
    (async () => {
      const options = {
        body: data.body,
        tag: data.tag,
        renotify: !!data.tag,
        icon: '/pwa/icon-192.png',
        // Android draws the badge as a silhouette of its alpha: the dove alone, not the tile.
        badge: '/pwa/badge-96.png',
        data: { url: data.url ?? '/' },
      }
      // Already looking at that game: the app shows it live, so stay quiet — but still
      // show (and at once close) a silent notification. Every push must display one
      // (userVisibleOnly): Safari revokes the subscription after a few silent pushes,
      // and Chrome shows its own "updated in the background" notice instead.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const watching = windows.some(
        (c) => c.focused && c.visibilityState === 'visible' && new URL(c.url).pathname === data.url,
      )
      const tag = watching ? `seen:${data.tag ?? Date.now()}` : data.tag
      await self.registration.showNotification(data.title ?? 'Diplomacy', {
        ...options,
        tag,
        ...(watching ? { silent: true, renotify: false } : {}),
      })
      if (watching) {
        for (const n of await self.registration.getNotifications({ tag })) n.close()
      }
    })(),
  )
})

// The browser rotated this device's push subscription (or expired it). Subscribe again
// with the same key; saving the new endpoint needs the user's session, so any open app
// window is asked to (src/lib/push.ts). With none open, the app saves it on next launch.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const key = event.oldSubscription?.options?.applicationServerKey
      const sub =
        event.newSubscription ??
        (key ? await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }) : null)
      if (!sub) return
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const c of windows) c.postMessage({ type: 'push-subscription-changed' })
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
