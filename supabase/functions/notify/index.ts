// Web Push sender. Postgres (public.push_notify) decides who is told what and posts
// { user_ids, payload } here with the adjudicator's shared secret; this function only
// looks up those users' subscriptions, sends, and drops the ones the push service
// reports gone.

import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

interface SubscriptionRow {
  endpoint: string
  p256dh: string
  auth: string
}

Deno.serve(async (req: Request): Promise<Response> => {
  const expected = Deno.env.get('ADJUDICATOR_SECRET')
  if (!expected || req.headers.get('Authorization') !== `Bearer ${expected}`) {
    return new Response('forbidden', { status: 403 })
  }

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  if (!publicKey || !privateKey) return new Response('push not configured', { status: 503 })
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@localhost', publicKey, privateKey)

  let userIds: string[]
  let payload: unknown
  try {
    ;({ user_ids: userIds, payload } = await req.json())
  } catch {
    return new Response('bad request', { status: 400 })
  }
  if (!Array.isArray(userIds) || userIds.length === 0) return Response.json({ sent: 0 })

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  const { data, error } = await db
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .in('user_id', userIds)
  if (error) return new Response(`error: ${error.message}`, { status: 500 })

  const body = JSON.stringify(payload)
  const gone: string[] = []
  const results = await Promise.allSettled(
    (data as SubscriptionRow[]).map((s) =>
      webpush
        .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 86400 })
        .catch((e: { statusCode?: number }) => {
          if (e.statusCode === 404 || e.statusCode === 410) gone.push(s.endpoint)
          throw e
        }),
    ),
  )
  if (gone.length) await db.from('push_subscriptions').delete().in('endpoint', gone)

  const failed = results.filter((r) => r.status === 'rejected')
  for (const f of failed) console.error('push failed', (f as PromiseRejectedResult).reason)
  return Response.json({ sent: results.length - failed.length, failed: failed.length, removed: gone.length })
})
