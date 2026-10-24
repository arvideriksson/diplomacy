import { describe, expect, it } from 'vitest'
import { formatCountdown, formatDeadline, formatMinutes, toLocalInput } from '../time'

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
