import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDebouncer } from '../debounce'

describe('createDebouncer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('runs once, with the last args, after the quiet period', () => {
    const fn = vi.fn()
    const d = createDebouncer(fn, 100)
    d.schedule(1)
    vi.advanceTimersByTime(60)
    d.schedule(2)
    vi.advanceTimersByTime(60)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(40)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(2)
  })

  it('flush runs a pending call immediately, and only once', () => {
    const fn = vi.fn()
    const d = createDebouncer(fn, 100)
    d.flush()
    expect(fn).not.toHaveBeenCalled()
    d.schedule('a', 'b')
    d.flush()
    expect(fn).toHaveBeenCalledWith('a', 'b')
    vi.advanceTimersByTime(200)
    d.flush()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('cancel drops a pending call', () => {
    const fn = vi.fn()
    const d = createDebouncer(fn, 100)
    d.schedule()
    d.cancel()
    vi.advanceTimersByTime(200)
    d.flush()
    expect(fn).not.toHaveBeenCalled()
  })
})
