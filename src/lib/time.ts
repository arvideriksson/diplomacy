// Duration and deadline formatting shared by the timer settings, the deadline banner
// and the host admin panel.

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
 */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'Resolving…'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${h}h left`
  if (h > 0) return `${h}h ${m}m left`
  if (m > 0) return `${m}m ${sec}s left`
  return `${sec}s left`
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
