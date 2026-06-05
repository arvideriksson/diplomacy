import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// In dev, isolate the auth session to a single tab so you can drive a multi-player game
// from several tabs at once (the point of the anonymous dev sign-in). Two things are
// needed for true isolation:
//   1. storage = sessionStorage — per-tab, not shared like the default localStorage.
//   2. a UNIQUE storageKey per tab — GoTrue also runs a cross-tab BroadcastChannel and
//      refresh lock keyed by storageKey; with the default shared key, one tab's
//      sign-in/token-refresh broadcasts its session to every other tab and clobbers
//      their in-memory user (so all tabs collapse onto one nation). A per-tab key gives
//      each tab its own channel, so sessions can't leak across tabs.
// The id lives in sessionStorage, so reloading a tab keeps its session. Production keeps
// the defaults (localStorage + shared key) so a real user stays signed in across tabs.
function devAuthOptions() {
  if (!import.meta.env.DEV) return undefined
  let tabId = sessionStorage.getItem('sb-tab-id')
  if (!tabId) {
    tabId = crypto.randomUUID()
    sessionStorage.setItem('sb-tab-id', tabId)
  }
  return { storage: window.sessionStorage, storageKey: `sb-dev-${tabId}` }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: devAuthOptions(),
})
