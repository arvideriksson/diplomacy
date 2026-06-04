import { writable, derived } from 'svelte/store'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS ?? '').split(',').map((e: string) => e.trim().toLowerCase()).filter(Boolean)

export const session = writable<Session | null>(null)
export const user = derived(session, ($session) => $session?.user ?? null)
export const isAuthenticated = derived(session, ($session) => $session !== null)
export const isSiteAdmin = derived(user, ($user) => $user?.email ? ADMIN_EMAILS.includes($user.email.toLowerCase()) : false)

export async function initAuth() {
  const { data } = await supabase.auth.getSession()
  session.set(data.session)

  supabase.auth.onAuthStateChange((_event, newSession) => {
    session.set(newSession)
  })
}

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
    },
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

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}
