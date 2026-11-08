import { describe, expect, it } from 'vitest'
import { adjudicate, boardFromUnits, idleNations, replayLog } from '..'
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

  describe('a dislodged unit with no retreat disbands at once', () => {
    const U = (nation: string, type: Unit['type'], territory: string): Unit => ({ type, nation, territory })
    const mv = (nation: string, source: string, target: string): AnyOrder => ({ type: 'Move', nation, source, target }) as AnyOrder
    const sup = (nation: string, source: string, aux: string, target: string): AnyOrder =>
      ({ type: 'Support', nation, source, aux, target }) as AnyOrder
    // Paris attacked from Picardy with support from Burgundy; Brest and Gascony are full.
    const trapped = [
      U('france', 'army', 'PAR'), U('france', 'army', 'GAS'), U('england', 'fleet', 'BRE'),
      U('england', 'army', 'PIC'), U('germany', 'army', 'BUR'),
    ]
    const attack = [mv('england', 'PIC', 'PAR'), sup('germany', 'BUR', 'PIC', 'PAR')]

    it('skips the retreat phase when no dislodged unit can retreat', () => {
      const b = boardFromUnits(classicalMap, trapped, 1901, 'Spring', 'movement')
      const r = adjudicate(classicalMap, b, attack)
      expect(r.newBoardState).toMatchObject({ phase: 'movement', season: 'Fall', year: 1901, dislodged: [] })
      expect(r.newBoardState.units.filter((u) => u.nation === 'france').map((u) => u.territory)).toEqual(['GAS'])
      expect(r.newBoardState.units.find((u) => u.territory === 'PAR')?.nation).toBe('england')
    })

    it('opens the retreat phase only for units that can retreat', () => {
      // Plus a German army in Holland dislodged from Belgium, free to retreat to Kiel.
      const units = [...trapped, U('germany', 'army', 'HOL'), U('england', 'army', 'BEL'), U('england', 'fleet', 'NTH')]
      const b = boardFromUnits(classicalMap, units, 1901, 'Spring', 'movement')
      const r = adjudicate(classicalMap, b, [...attack, mv('england', 'BEL', 'HOL'), sup('england', 'NTH', 'BEL', 'HOL')])
      expect(r.newBoardState.phase).toBe('retreat')
      expect(r.newBoardState.dislodged.map((d) => d.unit.territory)).toEqual(['HOL'])
      expect(r.newBoardState.units.some((u) => u.nation === 'france' && u.territory === 'PAR')).toBe(false)
    })

    it('replays a log holding a disband for a retreat phase that is now skipped', () => {
      const b = boardFromUnits(classicalMap, trapped, 1901, 'Spring', 'movement')
      const rows: LogRow[] = [
        { year: 1901, season: 'Spring', phase: 'movement', nation: 'england', orders: [attack[0]] },
        { year: 1901, season: 'Spring', phase: 'movement', nation: 'germany', orders: [attack[1]] },
        { year: 1901, season: 'Spring', phase: 'retreat', nation: 'france', orders: [{ type: 'Disband', nation: 'france', source: 'PAR' } as AnyOrder] },
      ]
      const frames = replayLog(classicalMap, b, rows)
      expect(frames.map((f) => `${f.board.season} ${f.board.phase}`)).toEqual(['Spring movement', 'Fall movement'])
    })
  })

  describe('a power left with no centers', () => {
    // Fall: England's three home centers, plus a French army stranded in Picardy.
    const units = [F('LON'), F('EDI'), A('LVP'), { type: 'army', nation: 'france', territory: 'PIC' } as Unit]

    it('is idle in a build phase that removes all its units', () => {
      const b = fall(units)
      b.phase = 'build'
      b.supplyCenters = { LON: 'england', EDI: 'england', LVP: 'england', NWY: 'england' }
      expect(idleNations(classicalMap, b)).toContain('france')
    })

    it('loses its units even when the build phase is skipped', () => {
      const r = adjudicate(classicalMap, fall(units), [])
      expect(r.newBoardState).toMatchObject({ phase: 'movement', season: 'Spring', year: 1902 })
      expect(r.newBoardState.units.some((u) => u.nation === 'france')).toBe(false)
    })
  })
})
