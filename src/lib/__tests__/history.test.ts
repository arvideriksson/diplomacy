import { describe, it, expect } from 'vitest'
import { classicalMap } from '../maps/classical'
import { initialBoard } from '../adjudicator'
import { replayFrames, type ResolvedOrderRow } from '../history'

describe('replayFrames', () => {
  it('reconstructs a board per phase from the resolved log', () => {
    // Spring 1901 movement: Germany A Munich -> Tyrolia (per-nation rows as stored)
    const log: ResolvedOrderRow[] = [
      { year: 1901, season: 'Spring', phase: 'movement', nation: 'germany',
        orders: [{ type: 'Move', nation: 'germany', source: 'MUN', target: 'TYR' }] },
    ]
    const frames = replayFrames(classicalMap, log)
    // one resolved round -> [frameForThatRound, frontier]
    expect(frames.length).toBe(2)
    // first frame = opening board, with its orders attached
    expect(frames[0].board.units).toEqual(initialBoard(classicalMap).units)
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
    const frames = replayFrames(classicalMap, log)
    expect(frames[0].board.season).toBe('Spring')
    expect(frames[1].board.season).toBe('Fall')
  })

  it('replays a phase that left no rows in the log (nobody had orders)', () => {
    // Spring 1901 has rows; Fall 1901 movement had none (everyone held by deadline);
    // Spring 1902 has rows again. The Fall phase must still be resolved in between.
    const log: ResolvedOrderRow[] = [
      { year: 1901, season: 'Spring', phase: 'movement', nation: 'germany',
        orders: [{ type: 'Move', nation: 'germany', source: 'MUN', target: 'BUR' }] },
      { year: 1902, season: 'Spring', phase: 'movement', nation: 'germany',
        orders: [{ type: 'Move', nation: 'germany', source: 'BUR', target: 'PIC' }] },
    ]
    const frames = replayFrames(classicalMap, log)
    const labels = frames.map((f) => `${f.board.season} ${f.board.year} ${f.board.phase}`)
    expect(labels).toEqual(['Spring 1901 movement', 'Fall 1901 movement', 'Spring 1902 movement', 'Fall 1902 movement'])
    // the 1902 move is applied to a unit that is really in Burgundy
    expect(frames.at(-1)!.board.units.find((u) => u.territory === 'PIC')?.nation).toBe('germany')
  })
})
