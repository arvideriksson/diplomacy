/**
 * Extract a human-readable message from an unknown thrown value. Supabase errors
 * (PostgrestError, FunctionsError, AuthError) are plain objects with a `.message`,
 * NOT `Error` instances — so `String(e)` on them yields "[object Object]". This
 * checks the common shapes before falling back.
 */
export function errorMessage(e: unknown): string {
  if (e == null) return 'Unknown error'
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  if (typeof e === 'object') {
    const o = e as Record<string, unknown>
    const msg = o.message ?? o.error_description ?? o.error ?? o.hint ?? o.details
    if (typeof msg === 'string' && msg.length > 0) return msg
    try {
      return JSON.stringify(e)
    } catch {
      return String(e)
    }
  }
  return String(e)
}
