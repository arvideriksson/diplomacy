// A private Realtime Broadcast topic kept joined for as long as it's wanted — shared by
// press (lib/chat.ts) and the game row's pushes (lib/game.ts).

import { supabase } from './supabase'
import { REALTIME_SUBSCRIBE_STATES, type RealtimeChannel } from '@supabase/supabase-js'

// Before joining a private topic, make sure Realtime holds a current access token: the
// join carries it for the Realtime Authorization (RLS) check, so a join raced against an
// unset token is refused. Pulled through supabase-js's accessToken callback rather than
// passed in — a token passed in counts as "manual" and turns off realtime-js's own
// refresh on every heartbeat, which is what keeps a long-lived join from expiring.
async function ensureRealtimeAuth(): Promise<void> {
  await supabase.realtime.setAuth()
}

/** A private Broadcast topic kept joined for as long as it's wanted. */
export interface LiveTopic {
  /** Leave the topic for good. */
  stop(): void
  /** Join again now if the server closed it (e.g. back from a suspended tab). */
  revive(): void
  /** Settles on the first successful join. */
  joined: Promise<void>
}

// Backoff between attempts to re-join a topic the server closed.
const REJOIN_MS = [1000, 2000, 5000, 10_000, 30_000]

/**
 * Join a private Broadcast topic and keep it joined. `onJoined` runs after EVERY
 * successful join — `first` on the very first — since whatever was broadcast before
 * the join (or while it was down) never arrives and has to be fetched.
 *
 * A dropped socket or a refused/timed-out join is retried by realtime-js itself, but a
 * topic the SERVER closes (it does when the access token expires, e.g. while a phone
 * kept the app suspended past the token's lifetime) is removed from the socket for good.
 * That's what made live press die silently; here a closed topic is joined afresh.
 */
export function keepJoined(
  topic: string,
  /** Handler per Broadcast event name. */
  handlers: Record<string, (payload: unknown) => void>,
  onJoined: (first: boolean) => void,
): LiveTopic {
  let current: RealtimeChannel | null = null
  let stopped = false
  let joinedOnce = false
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let markJoined = () => {}
  const joined = new Promise<void>((resolve) => (markJoined = resolve))

  async function open() {
    timer = null
    if (stopped) return
    await ensureRealtimeAuth().catch(() => {})
    if (stopped || current) return
    const ch = supabase.channel(topic, { config: { private: true } })
    current = ch
    for (const [event, handle] of Object.entries(handlers)) ch.on('broadcast', { event }, (msg) => handle(msg.payload))
    ch.subscribe((status) => {
      if (stopped || current !== ch) return
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        attempt = 0
        const first = !joinedOnce
        joinedOnce = true
        markJoined()
        onJoined(first)
      } else if (status === REALTIME_SUBSCRIBE_STATES.CLOSED) {
        current = null
        retryLater()
      }
      // CHANNEL_ERROR / TIMED_OUT: the channel stays on the socket and rejoins by itself.
    })
  }

  function retryLater() {
    if (stopped || timer) return
    timer = setTimeout(open, REJOIN_MS[Math.min(attempt++, REJOIN_MS.length - 1)])
  }

  void open()
  return {
    joined,
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
      const ch = current
      current = null
      if (ch) supabase.removeChannel(ch)
    },
    revive() {
      if (stopped) return
      if (current && current.state !== 'closed') return
      if (timer) clearTimeout(timer)
      timer = null
      current = null
      void open()
    },
  }
}
