import { describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { deadlineState, formatCountdown, formatDeadline, formatMinutes, nowStore, toLocalInput, URGENT_MS } from '../time'

describe('formatMinutes', () => {
  it('uses the largest exact unit', () => {
    expect(formatMinutes(10080)).toBe('1w')
    expect(formatMinutes(20160)).toBe('2w')
    expect(formatMinutes(2880)).toBe('2d')
    expect(formatMinutes(720)).toBe('12h')
    expect(formatMinutes(90)).toBe('90m')
    expect(formatMinutes(1)).toBe('1m')
  })
  it('renders zero with the given label', () => {
    expect(formatMinutes(0)).toBe('0m')
    expect(formatMinutes(0, { zeroLabel: 'Off' })).toBe('Off')
  })
})

describe('formatCountdown', () => {
  const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H
  it('shows the two leading units', () => {
    expect(formatCountdown(2 * D + 3 * H + 4 * M)).toBe('2d 3h left')
    expect(formatCountdown(4 * H + 5 * M + 6 * S)).toBe('4h 5m left')
    expect(formatCountdown(6 * M + 7 * S + 999)).toBe('6m 7s left')
    expect(formatCountdown(8 * S)).toBe('8s left')
    expect(formatCountdown(500)).toBe('0s left')
  })
  it('drops the suffix and seconds on request', () => {
    expect(formatCountdown(4 * H + 5 * M, { suffix: false })).toBe('4h 5m')
    expect(formatCountdown(6 * M + 7 * S, { seconds: false })).toBe('6m left')
    expect(formatCountdown(20 * S, { suffix: false, seconds: false })).toBe('1m')
    expect(formatCountdown(3 * D + 4 * H, { suffix: false, seconds: false })).toBe('3d 4h')
  })
  it('reads as resolving once due', () => {
    expect(formatCountdown(0)).toBe('Resolving…')
    expect(formatCountdown(-5000)).toBe('Resolving…')
  })
})

describe('formatDeadline', () => {
  it('is empty without a deadline', () => {
    expect(formatDeadline(null)).toBe('')
    expect(formatDeadline(undefined)).toBe('')
    expect(formatDeadline('')).toBe('')
  })
  it('formats ISO strings and epoch ms alike', () => {
    const iso = '2026-03-04T18:30:00Z'
    const out = formatDeadline(iso, 'en-US')
    expect(out).toBe(formatDeadline(Date.parse(iso), 'en-US'))
    expect(out).toMatch(/Mar/)
    expect(out).toMatch(/:30/)
  })
})

describe('toLocalInput', () => {
  it('is empty without a value', () => {
    expect(toLocalInput(null)).toBe('')
    expect(toLocalInput(undefined)).toBe('')
  })
  it('round-trips through a local Date', () => {
    const local = new Date(2026, 0, 5, 7, 9) // 2026-01-05 07:09 local
    expect(toLocalInput(local.toISOString())).toBe('2026-01-05T07:09')
    expect(new Date(toLocalInput(local.toISOString())).getTime()).toBe(local.getTime())
  })
})

describe('deadlineState', () => {
  const now = Date.parse('2026-03-04T12:00:00Z')
  const at = (ms: number) => new Date(now + ms).toISOString()
  const H = 60 * 60 * 1000

  it('is none without a deadline', () => {
    expect(deadlineState(null, null, now)).toEqual({ kind: 'none', msLeft: null, urgent: false })
    expect(deadlineState(undefined, at(H), now).kind).toBe('none')
  })
  it('is open before the deadline, urgent within the hour', () => {
    expect(deadlineState(at(2 * H), null, now)).toEqual({ kind: 'open', msLeft: 2 * H, urgent: false })
    expect(deadlineState(at(URGENT_MS), null, now).urgent).toBe(true)
    expect(deadlineState(now + 5000, at(2 * H), now)).toEqual({ kind: 'open', msLeft: 5000, urgent: true })
  })
  it('is grace past the deadline while grace_ends_at is ahead', () => {
    expect(deadlineState(at(-H), at(3 * H), now)).toEqual({ kind: 'grace', msLeft: 3 * H, urgent: true })
    expect(deadlineState(at(0), at(1000), now).kind).toBe('grace')
  })
  it('is resolving past the deadline with no grace left', () => {
    expect(deadlineState(at(-1000), null, now)).toEqual({ kind: 'resolving', msLeft: -1000, urgent: true })
    expect(deadlineState(at(-H), at(-1), now).kind).toBe('resolving')
    expect(deadlineState(at(0), at(0), now).kind).toBe('resolving')
  })
})

describe('nowStore', () => {
  it('ticks while subscribed and shares one clock per interval', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_000_000)
      const clock = nowStore(1000)
      expect(nowStore(1000)).toBe(clock)
      const seen: number[] = []
      const stop = clock.subscribe((t) => seen.push(t))
      vi.advanceTimersByTime(2000)
      stop()
      vi.advanceTimersByTime(5000)
      expect(seen).toEqual([1_000_000, 1_001_000, 1_002_000])
      expect(get(clock)).toBe(1_007_000)
    } finally {
      vi.useRealTimers()
    }
  })
})
