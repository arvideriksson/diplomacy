import { writable, derived } from 'svelte/store'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { rpc } from './rpc'
import { disablePush } from './push'

const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS ?? '').split(',').map((e: string) => e.trim().toLowerCase()).filter(Boolean)

export const session = writable<Session | null>(null)
export const user = derived(session, ($session) => $session?.user ?? null)
export const isAuthenticated = derived(session, ($session) => $session !== null)
export const isSiteAdmin = derived(user, ($user) => $user?.email ? ADMIN_EMAILS.includes($user.email.toLowerCase()) : false)

/** The name a user goes by: the one they chose, else the provider's. */
export function metaDisplayName(meta: Record<string, any> | undefined): string | undefined {
  return meta?.display_name ?? meta?.full_name ?? meta?.name ?? undefined
}

export const displayName = derived(user, ($user) => $user ? (metaDisplayName($user.user_metadata) ?? $user.email ?? null) : null)

/** A real (non-test) account that hasn't picked a name yet — prompted on first sign-in. */
export const needsDisplayName = derived(user, ($user) => !!$user && !$user.is_anonymous && !$user.user_metadata?.display_name)

// The path to resume after the OAuth round-trip (e.g. /join/<id>). Kept client-side
// because GoTrue falls back to the site URL when `redirectTo` isn't on the project's
// redirect allowlist, which would drop a deep link.
const RETURN_PATH_KEY = 'auth-return-path'

function takeReturnPath(): string | null {
  try {
    const path = sessionStorage.getItem(RETURN_PATH_KEY)
    sessionStorage.removeItem(RETURN_PATH_KEY)
    return path
  } catch {
    return null
  }
}

export async function initAuth() {
  const { data } = await supabase.auth.getSession()
  session.set(data.session)

  // Runs before the router mounts, so a plain history swap is enough to land on the path.
  const returnPath = takeReturnPath()
  if (data.session && returnPath?.startsWith('/') && returnPath !== location.pathname + location.search) {
    history.replaceState(null, '', returnPath)
  }

  supabase.auth.onAuthStateChange((_event, newSession) => {
    session.set(newSession)
  })
}

export async function signInWithGoogle() {
  try {
    sessionStorage.setItem(RETURN_PATH_KEY, location.pathname + location.search)
  } catch {}
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    // The origin always matches the site URL; initAuth restores the deep link.
    options: { redirectTo: window.location.origin },
  })
  if (error) throw error
}

/**
 * Dev-only: sign in as a throwaway anonymous user. Each call mints a distinct
 * `auth.uid()` with the normal `authenticated` role, so every RPC/RLS path behaves
 * exactly as it would for a real Google user — only `is_anonymous` differs. Used to
 * stand up multi-player games locally without N real accounts. Guard every call site
 * behind `import.meta.env.DEV` so it never reaches production.
 */
export async function signInAnonymously(displayName?: string) {
  const name = displayName ?? `Tester ${Math.random().toString(36).slice(2, 6).toUpperCase()}`
  const { error } = await supabase.auth.signInAnonymously({
    options: { data: { full_name: name, name } },
  })
  if (error) throw error
}

/**
 * Choose / change the signed-in user's name. The RPC stores it on the account and copies
 * it into every game roster they're in; the session refresh pulls the new metadata into
 * `user`.
 */
export async function setDisplayName(name: string) {
  await rpc('set_display_name', { p_name: name })
  const { error } = await supabase.auth.refreshSession()
  if (error) throw error
}

export async function signOut() {
  // This device shouldn't keep buzzing for an account that left it.
  await disablePush().catch(() => {})
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}
