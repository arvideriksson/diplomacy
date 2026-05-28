import { writable, derived } from 'svelte/store'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export const session = writable<Session | null>(null)
export const user = derived(session, ($session) => $session?.user ?? null)
export const isAuthenticated = derived(session, ($session) => $session !== null)

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
