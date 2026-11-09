// Duration and deadline formatting shared by the timer settings, the deadline banner
// and the host controls, plus the shared deadline state and ticking clock.
import { readable, type Readable } from 'svelte/store'

const MINUTES_PER = { w: 10080, d: 1440, h: 60 } as const

/**
 * A whole-minute duration in its largest exact unit: 10080 → "1w", 2880 → "2d",
 * 90 → "90m". Zero renders as `zeroLabel` (e.g. "Off" for a disabled grace period),
 * or "0m" when none is given.
 */
export function formatMinutes(min: number, opts: { zeroLabel?: string } = {}): string {
  if (min === 0) return opts.zeroLabel ?? '0m'
  for (const [unit, size] of Object.entries(MINUTES_PER)) {
    if (min % size === 0) return `${min / size}${unit}`
  }
  return `${min}m`
}

/**
 * Time left until a deadline, coarsened to its two leading units: "2d 3h left",
 * "4h 5m left", "6m 7s left", "8s left". At or past zero: "Resolving…".
 * `suffix: false` drops " left"; `seconds: false` stops at whole minutes (at least "1m").
 */
export function formatCountdown(ms: number, opts: { suffix?: boolean; seconds?: boolean } = {}): string {
  if (ms <= 0) return 'Resolving…'
  const tail = opts.suffix === false ? '' : ' left'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${h}h${tail}`
  if (h > 0) return `${h}h ${m}m${tail}`
  if (opts.seconds === false) return `${Math.max(1, m)}m${tail}`
  if (m > 0) return `${m}m ${sec}s${tail}`
  return `${sec}s${tail}`
}

/** A deadline this close (or closer) reads as urgent. */
export const URGENT_MS = 60 * 60 * 1000

export interface DeadlineState {
  /**
   * none: no deadline. open: before the deadline. grace: the deadline has passed and
   * grace_ends_at is still ahead. resolving: past the deadline with no grace left.
   */
  kind: 'none' | 'open' | 'grace' | 'resolving'
  /** Until the deadline (open), the grace period's end (grace); ≤ 0 resolving; null none. */
  msLeft: number | null
  /** Within URGENT_MS of the deadline, in grace, or resolving. */
  urgent: boolean
}

const toMs = (t: string | number | null | undefined): number | null =>
  t == null || t === '' ? null : typeof t === 'number' ? t : Date.parse(t)

/** Where a phase stands against its deadline and grace period at `now`. */
export function deadlineState(
  deadline: string | number | null | undefined,
  graceEndsAt: string | number | null | undefined,
  now: number,
): DeadlineState {
  const d = toMs(deadline)
  if (d == null || Number.isNaN(d)) return { kind: 'none', msLeft: null, urgent: false }
  const left = d - now
  if (left > 0) return { kind: 'open', msLeft: left, urgent: left <= URGENT_MS }
  const g = toMs(graceEndsAt)
  if (g != null && g > now) return { kind: 'grace', msLeft: g - now, urgent: true }
  return { kind: 'resolving', msLeft: left, urgent: true }
}

const clocks = new Map<number, Readable<number>>()

/** `Date.now()`, updated every `intervalMs` while anything subscribes (one timer per interval). */
export function nowStore(intervalMs = 1000): Readable<number> {
  let clock = clocks.get(intervalMs)
  if (!clock) {
    clock = readable(Date.now(), (set) => {
      set(Date.now())
      const id = setInterval(() => set(Date.now()), intervalMs)
      return () => clearInterval(id)
    })
    clocks.set(intervalMs, clock)
  }
  return clock
}

const deadlineFormats = new Map<string, Intl.DateTimeFormat>()

/**
 * A deadline as an exact local date-time, e.g. "Tue, Mar 4, 6:30 PM CET". Accepts an
 * ISO string or epoch ms; empty for a missing deadline. `locale` defaults to the
 * user's.
 */
export function formatDeadline(when: string | number | null | undefined, locale?: string): string {
  if (when == null || when === '') return ''
  const key = locale ?? ''
  let fmt = deadlineFormats.get(key)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    })
    deadlineFormats.set(key, fmt)
  }
  return fmt.format(typeof when === 'number' ? when : new Date(when).getTime())
}

const pad = (n: number) => String(n).padStart(2, '0')

/** An ISO timestamp as the local "YYYY-MM-DDTHH:mm" value a datetime-local input takes. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
