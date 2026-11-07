import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { AnyOrder } from './types'
import type { Unit } from '../game'

vi.mock('./api', () => ({
  fetchMyOrders: vi.fn(),
  saveDraftOrders: vi.fn(),
  submitOrders: vi.fn(),
}))
vi.mock('../draftBackup', async (importActual) => ({
  ...(await importActual<typeof import('../draftBackup')>()),
  readDraftBackup: vi.fn(() => null),
  writeDraftBackup: vi.fn(),
}))

import { fetchMyOrders, saveDraftOrders, submitOrders } from './api'
import { readDraftBackup, writeDraftBackup } from '../draftBackup'
import { createOrderSession, DRAFT_DEBOUNCE_MS } from './session'

const fetchMock = vi.mocked(fetchMyOrders)
const saveMock = vi.mocked(saveDraftOrders)
const submitMock = vi.mocked(submitOrders)
const readBackupMock = vi.mocked(readDraftBackup)
const writeBackupMock = vi.mocked(writeDraftBackup)

const round = { gameId: 'g1', nation: 'England', year: 1901, season: 'Spring', phase: 'movement' }
const units: Unit[] = [
  { nation: 'England', type: 'fleet', territory: 'Edi' } as Unit,
  { nation: 'England', type: 'army', territory: 'Lvp' } as Unit,
]
const move = (source: string, target: string): AnyOrder =>
  ({ type: 'Move', nation: 'England', source, target }) as AnyOrder
const saved = [move('Edi', 'NTH')]

function session(opts: { ready?: boolean; persist?: boolean } = {}) {
  const onChange = vi.fn()
  const s = createOrderSession({
    round: () => round,
    ready: () => opts.ready ?? false,
    ownUnits: () => units,
    persist: () => opts.persist ?? true,
    onChange,
  })
  return { s, onChange }
}

// Let pending promise callbacks (the awaited fetch) run.
const settle = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  readBackupMock.mockReturnValue(null)
  saveMock.mockResolvedValue(undefined)
  submitMock.mockResolvedValue(undefined)
})
afterEach(() => vi.useRealTimers())

describe('order session: failed load', () => {
  it('never autosaves an edit or submits while the saved set is unknown', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    const { s } = session()
    s.enterRound(null)
    await settle()
    expect(get(s.loadFailed)).toBe(true)
    expect(get(s.saveError)).toMatch(/retrying/)

    s.edit([move('Lvp', 'Yor')])
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS * 2)
    s.flush()
    expect(saveMock).not.toHaveBeenCalled()
    // …but the edit is kept on the device.
    expect(writeBackupMock).toHaveBeenLastCalledWith(round, [move('Lvp', 'Yor')])

    await s.submit()
    expect(submitMock).not.toHaveBeenCalled()
    s.destroy()
  })

  it('retries with backoff, and a successful retry re-enables saving and submit', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'))
    fetchMock.mockResolvedValue(saved)
    const { s, onChange } = session()
    s.enterRound(null)
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1) // first retry after 2s (fails again)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(get(s.loadFailed)).toBe(true)
    await vi.advanceTimersByTimeAsync(3999)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1) // second retry after 4s (succeeds)
    expect(fetchMock).toHaveBeenCalledTimes(3)

    expect(get(s.loadFailed)).toBe(false)
    expect(get(s.saveError)).toBe('')
    expect(get(s.orders)).toEqual(saved)
    expect(onChange).toHaveBeenLastCalledWith(saved)

    const edited = [...saved, move('Lvp', 'Yor')]
    s.edit(edited)
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS)
    expect(saveMock).toHaveBeenCalledWith('g1', edited, { year: 1901, season: 'Spring', phase: 'movement' })

    await s.submit()
    expect(submitMock).toHaveBeenCalledTimes(1)
    expect(get(s.readyOverride)).toBe(true)
    s.destroy()
  })

  it('drops a retry once the round has moved on', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    const live = session().s
    live.enterRound(null)
    await settle()
    live.enterRound(null) // new round: loads again immediately
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2000) // only the newer round's retry fires
    expect(fetchMock).toHaveBeenCalledTimes(3)
    live.destroy()
  })
})

describe('order session: device backup', () => {
  it('restores an unsaved draft and schedules its autosave', async () => {
    const backup = [move('Edi', 'NWG')]
    fetchMock.mockResolvedValue(saved)
    readBackupMock.mockReturnValue(backup)
    const { s, onChange } = session()
    s.enterRound(null)
    await settle()
    expect(get(s.orders)).toEqual(backup)
    expect(get(s.dirtySinceSubmit)).toBe(false)
    expect(onChange).toHaveBeenLastCalledWith(backup)
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS)
    expect(saveMock).toHaveBeenCalledWith('g1', backup, expect.anything())
    s.destroy()
  })

  it('restores unsent edits to a submitted set as dirty, without autosaving', async () => {
    const backup = [move('Edi', 'NWG')]
    fetchMock.mockResolvedValue(saved)
    readBackupMock.mockReturnValue(backup)
    const { s } = session({ ready: true })
    s.enterRound(null)
    await settle()
    expect(get(s.orders)).toEqual(backup)
    expect(get(s.submittedOrders)).toEqual(saved)
    expect(get(s.dirtySinceSubmit)).toBe(true)
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS * 2)
    expect(saveMock).not.toHaveBeenCalled()
    s.destroy()
  })

  it('clears a backup that matches the submitted set', async () => {
    fetchMock.mockResolvedValue(saved)
    readBackupMock.mockReturnValue([...saved])
    const { s } = session({ ready: true })
    s.enterRound(null)
    await settle()
    expect(get(s.dirtySinceSubmit)).toBe(false)
    expect(get(s.orders)).toEqual(saved)
    s.destroy()
  })

  it('without a backup, loads the saved set and clears any stale backup', async () => {
    fetchMock.mockResolvedValue(saved)
    const { s } = session()
    s.enterRound(null)
    await settle()
    expect(get(s.orders)).toEqual(saved)
    expect(writeBackupMock).toHaveBeenCalledWith(round, null)
    s.destroy()
  })
})

describe('order session: autosave and submit', () => {
  it('drops a pending autosave on round change but flushes it on destroy', async () => {
    fetchMock.mockResolvedValue([])
    const { s } = session()
    s.enterRound(null)
    await settle()
    s.edit([move('Edi', 'NTH')])
    s.enterRound(null) // round change: dropped
    await settle()
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS * 2)
    expect(saveMock).not.toHaveBeenCalled()

    s.edit([move('Edi', 'NTH')])
    s.destroy() // leaving: flushed immediately
    expect(saveMock).toHaveBeenCalledTimes(1)
  })

  it('submits un-ordered units as holds and marks the set submitted', async () => {
    fetchMock.mockResolvedValue([])
    const { s } = session()
    s.enterRound(null)
    await settle()
    s.edit([move('Edi', 'NTH')])
    await s.submit()
    expect(saveMock).not.toHaveBeenCalled() // the pending autosave was dropped
    const committed = submitMock.mock.calls[0][1]
    expect(committed).toHaveLength(2)
    expect(committed.find((o) => o.source === 'Lvp')?.type).toBe('Hold')
    expect(get(s.submittedOrders)).toEqual(committed)
    expect(get(s.dirtySinceSubmit)).toBe(false)
    expect(get(s.hasResubmitted)).toBe(false)

    // Phase 2: an edit is backed up and flagged, never saved.
    s.edit([move('Edi', 'NWG')])
    expect(get(s.dirtySinceSubmit)).toBe(true)
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS * 2)
    expect(saveMock).not.toHaveBeenCalled()

    await s.submit()
    expect(get(s.hasResubmitted)).toBe(true)
    s.syncReady(true) // the prop caught up
    expect(get(s.readyOverride)).toBe(null)
    s.destroy()
  })

  it('a sandbox session presets the orders and never touches the server', async () => {
    const preset = [move('Edi', 'NTH')]
    const { s, onChange } = session({ persist: false })
    s.enterRound(preset)
    expect(get(s.orders)).toEqual(preset)
    expect(onChange).not.toHaveBeenCalled()
    s.edit([])
    expect(onChange).toHaveBeenCalledWith([])
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS * 2)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(saveMock).not.toHaveBeenCalled()
    expect(writeBackupMock).not.toHaveBeenCalled()
    s.destroy()
  })
})
