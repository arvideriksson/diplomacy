// Keep the installed app (and any open tab) on the newest build. The service worker
// serves the cached app shell, so without this a phone that resumes the app from the
// background keeps running the old code until a full reload — and old code can break
// against a newer database (it did when games.ready was hidden in migration 154).
//
// Checks: on open, whenever the app comes back to the foreground, and every 30 minutes
// while it's open. Applying a found update reloads the page, so it's timed to never
// interrupt a turn: right away if the app was opened or resumed in the last few
// seconds, otherwise the moment it's next hidden (it reloads in the background and the
// player comes back to the new build).
import { registerSW } from 'virtual:pwa-register'

const CHECK_EVERY_MS = 30 * 60_000
/** An update found this soon after opening/resuming applies at once. */
const FRESH_MS = 10_000

export function keepAppUpdated(): void {
  let shownAt = Date.now()
  let pending = false
  let applying = false

  const apply = () => {
    if (applying) return
    applying = true
    void updateSW(true) // activate the waiting worker, then reload
  }

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      pending = true
      if (document.visibilityState === 'hidden' || Date.now() - shownAt < FRESH_MS) apply()
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => {
        if (navigator.onLine && !applying) registration.update().catch(() => {})
      }
      setInterval(() => document.visibilityState === 'visible' && check(), CHECK_EVERY_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          shownAt = Date.now()
          check()
        } else if (pending) {
          apply()
        }
      })
    },
  })
}
