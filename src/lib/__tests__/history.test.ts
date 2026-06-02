import { describe, it, expect } from 'vitest'
import { standardMap } from '../maps/standard'
import { initialBoard } from '../adjudicator'
import { replayFrames, type ResolvedOrderRow } from '../history'

describe('replayFrames', () => {
  it('reconstructs a board per phase from the resolved log', () => {
    // Spring 1901 movement: Germany A Munich -> Tyrolia (per-nation rows as stored)
    const log: ResolvedOrderRow[] = [
      { year: 1901, season: 'Spring', phase: 'movement', nation: 'germany',
        orders: [{ type: 'Move', nation: 'germany', source: 'MUN', target: 'TYR' }] },
    ]
    const frames = replayFrames(standardMap, log)
    // one resolved round -> [frameForThatRound, frontier]
    expect(frames.length).toBe(2)
    // first frame = opening board, with its orders attached
    expect(frames[0].board.units).toEqual(initialBoard(standardMap).units)
    expect(frames[0].orders.length).toBe(1)
    // frontier board reflects the move and advanced phase
    expect(frames[1].board.units.find((u) => u.territory === 'TYR')?.nation).toBe('germany')
    expect(frames[1].board.units.some((u) => u.territory === 'MUN')).toBe(false)
    expect(frames[1].board.season).toBe('Fall')
  })

  it('orders rounds chronologically regardless of row order', () => {
    const log: ResolvedOrderRow[] = [
      { year: 1901, season: 'Fall', phase: 'movement', nation: 'germany', orders: [] },
      { year: 1901, season: 'Spring', phase: 'movement', nation: 'germany', orders: [] },
    ]
    const frames = replayFrames(standardMap, log)
    expect(frames[0].board.season).toBe('Spring')
    expect(frames[1].board.season).toBe('Fall')
  })
})
