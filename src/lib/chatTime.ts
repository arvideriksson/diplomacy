// Timestamps for the press panel, in the shapes chat apps use: a clock time inside a
// bubble, a relative day on the separators, and the shortest unambiguous form in the list.

const DAY = 86_400_000

/** Midnight (local) of the day containing `d`. */
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** Whole local days between `iso` and now (0 = today, 1 = yesterday). */
function daysAgo(iso: string, now = new Date()): number {
  return Math.round((startOfDay(now) - startOfDay(new Date(iso))) / DAY)
}

/** "14:05" — the time shown on a message. */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** "Today", "Yesterday", "Monday", or "12 March" — the label of a day separator. */
export function dayLabel(iso: string): string {
  const days = daysAgo(iso)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  const d = new Date(iso)
  if (days < 7) return d.toLocaleDateString([], { weekday: 'long' })
  return d.toLocaleDateString([], {
    day: 'numeric',
    month: 'long',
    year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  })
}

/** "14:05", "Yesterday", "Mon", or "12/03" — a conversation's last activity in the list. */
export function listTime(iso: string): string {
  const days = daysAgo(iso)
  if (days <= 0) return clockTime(iso)
  if (days === 1) return 'Yesterday'
  if (days < 7) return new Date(iso).toLocaleDateString([], { weekday: 'short' })
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'numeric' })
}

/** Whether two messages fall on the same local day (a separator goes between them otherwise). */
export function sameDay(a: string, b: string): boolean {
  return startOfDay(new Date(a)) === startOfDay(new Date(b))
}
