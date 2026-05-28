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

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}
