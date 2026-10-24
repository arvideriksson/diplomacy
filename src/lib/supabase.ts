import { createClient } from '@supabase/supabase-js'

// Without a configured project (e.g. a local checkout with no .env) the app still
// loads: sandboxes run entirely in the browser, and network calls simply fail.
const supabaseConfigured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'unconfigured'
if (!supabaseConfigured) console.warn('Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY); only sandboxes will work.')

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

/** Call a Postgres RPC; throws its error, else returns its result. */
export async function rpc<T = void>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}
