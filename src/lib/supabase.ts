import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// In dev, keep the auth session in sessionStorage (scoped to a single tab) instead
// of the default localStorage (shared across all tabs/incognito windows of an
// origin). Per-tab storage lets each tab hold a *different* signed-in user, so you
// can drive a multi-player game from several tabs at once — which is exactly what
// the anonymous dev sign-in is for. Production keeps localStorage so a real user
// stays signed in across tabs and restarts.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: import.meta.env.DEV ? { storage: window.sessionStorage } : undefined,
})
