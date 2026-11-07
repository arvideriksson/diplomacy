// Keep the installed app (and any open tab) on the newest build. The service worker
// serves the cached app shell, so without this a phone that resumes the app from the
// background keeps running the old code until a full reload — and old code can break
// against a newer database (it did when games.ready was hidden in migration 154).
//
// Updates only ever apply while the app is hidden, so a reload can never land under the
// player's finger (a reload started on the game list while they tapped into a game used
// to drop them back on the list). Each time the app goes to the background it applies an
// update that's already waiting, or else checks for one. An update found while visible —
// including the browser's own check on launch — waits for the next time it's hidden.
import { registerSW } from 'virtual:pwa-register'

export function keepAppUpdated(): void {
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
      if (document.visibilityState === 'hidden') apply()
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'hidden' || applying) return
        if (pending) apply()
        // The worker installs on its own even if the page is frozen meanwhile; a find
        // that finishes after that applies the next time the app is hidden.
        else if (navigator.onLine) registration.update().catch(() => {})
      })
    },
  })
}
