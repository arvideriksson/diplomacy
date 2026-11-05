// Sandboxes on a map the app no longer has (e.g. 'standard', renamed 'classical' in
// migration 126) are dropped from storage as they load; the rest load as before.
import { describe, expect, it } from 'vitest'

const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage

describe('stored sandboxes', () => {
  it('drops sandboxes on maps that no longer exist', async () => {
    const { initialBoard } = await import('../adjudicator')
    const { classicalMap } = await import('../maps/classical')
    const frames = [{ board: initialBoard(classicalMap), orders: [] }]
    store.set('diplomacy:sandboxes', JSON.stringify([
      { id: 'old', name: 'Old', mapId: 'standard', frames, cursor: 0, createdAt: '2026-01-01' },
      { id: 'ok', name: 'Fine', mapId: 'classical', frames, cursor: 0, createdAt: '2026-01-02' },
    ]))
    const { getSandbox } = await import('../sandbox')
    expect(getSandbox('old')).toBeUndefined()
    expect(getSandbox('ok')?.name).toBe('Fine')
    expect(JSON.parse(store.get('diplomacy:sandboxes')!).map((s: { id: string }) => s.id)).toEqual(['ok'])
  })
})
