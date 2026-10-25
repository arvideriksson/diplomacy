import { createClient } from '@supabase/supabase-js'

// Without a configured project (e.g. a local checkout with no .env) the app still
// loads: sandboxes run entirely in the browser, and network calls simply fail.
export const supabaseConfigured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321'
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'unconfigured'
if (!supabaseConfigured) console.warn('Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY); only sandboxes will work.')

/** The project this dev server talks to: 'local' (the Docker stack) or 'live' — set by vite.config.ts. */
export const backendTarget: 'local' | 'live' = import.meta.env.VITE_BACKEND === 'local' ? 'local' : 'live'

/**
 * Dev-only test seats: up to seven independent sessions that live side by side in
 * localStorage, one per storage key (`sb-dev-seat-<backend>-<n>`). The backend is part of
 * the key because `npm run dev` and `dev:live` share the localhost origin, and a live
 * session is meaningless to the local stack (and vice versa). Each tab picks its active seat
 * from sessionStorage (default 1), so one tab can hop between players (see
 * src/lib/devSeats.ts) and several tabs can still sit in different seats at once — a
 * distinct storageKey also gives each seat its own GoTrue BroadcastChannel, so seats
 * never clobber each other. Production keeps the defaults.
 */
export const DEV_SEAT_COUNT = 7

export function devSeatStorageKey(seat: number) {
  return `sb-dev-seat-${backendTarget}-${seat}`
}

export function activeDevSeat(): number {
  const seat = Number(sessionStorage.getItem('dev-seat'))
  return seat >= 1 && seat <= DEV_SEAT_COUNT ? seat : 1
}

function devAuthOptions() {
  if (!import.meta.env.DEV) return undefined
  return { storage: window.localStorage, storageKey: devSeatStorageKey(activeDevSeat()) }
}

// RPC writes (draft autosave, submit, press) are small; sending them with `keepalive` lets
// one flushed as the page is closed or navigated away still reach the server.
const keepaliveFetch: typeof fetch = (input, init) =>
  String(input instanceof Request ? input.url : input).includes('/rest/v1/rpc/')
    ? fetch(input, { ...init, keepalive: true })
    : fetch(input, init)

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: devAuthOptions(),
  global: { fetch: keepaliveFetch },
})
