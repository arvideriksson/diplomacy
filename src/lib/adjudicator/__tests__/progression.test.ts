import { describe, expect, it } from 'vitest'
import { adjudicate, boardFromUnits, replayLog } from '..'
import type { AnyOrder, BoardState, LogRow } from '..'
import type { Unit } from '../../types'
import { classicalMap } from '../../maps/classical'

const A = (territory: string): Unit => ({ type: 'army', nation: 'england', territory })
const F = (territory: string): Unit => ({ type: 'fleet', nation: 'england', territory })
const move = (source: string, target: string): AnyOrder => ({ type: 'Move', nation: 'england', source, target }) as AnyOrder

/** Fall 1901: England holds its three home centers plus Norway, with three units. */
function fall(units: Unit[]): BoardState {
  const b = boardFromUnits(classicalMap, units, 1901, 'Fall', 'movement')
  b.supplyCenters = { LON: 'england', EDI: 'england', LVP: 'england', NWY: 'england' }
  return b
}

describe('phase progression', () => {
  it('skips a build phase in which every power is idle (a build owed, no free home center)', () => {
    const r = adjudicate(classicalMap, fall([F('LON'), F('EDI'), A('LVP')]), [])
    expect(r.newBoardState).toMatchObject({ phase: 'movement', season: 'Spring', year: 1902 })
  })

  it('opens the build phase when a home center is free to build in', () => {
    const r = adjudicate(classicalMap, fall([F('LON'), F('EDI'), A('LVP')]), [move('LVP', 'YOR')])
    expect(r.newBoardState).toMatchObject({ phase: 'build', season: 'Fall', year: 1901 })
  })

  it('replays a log holding rows for a build phase that is now skipped', () => {
    const rows: LogRow[] = [
      // An old game opened this all-idle build phase and someone saved an empty set.
      { year: 1901, season: 'Fall', phase: 'build', nation: 'england', orders: [] },
      { year: 1902, season: 'Spring', phase: 'movement', nation: 'england', orders: [move('LON', 'NTH')] },
    ]
    const frames = replayLog(classicalMap, fall([F('LON'), F('EDI'), A('LVP')]), rows)
    expect(frames.map((f) => `${f.board.season} ${f.board.year} ${f.board.phase}`)).toEqual([
      'Fall 1901 movement',
      'Spring 1902 movement',
      'Fall 1902 movement',
    ])
    expect(frames.at(-1)!.board.units.some((u) => u.territory === 'NTH')).toBe(true)
  })
})
