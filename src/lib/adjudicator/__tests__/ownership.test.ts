import { describe, expect, it } from 'vitest'
import { adjudicate, boardFromUnits } from '..'
import type { AnyOrder } from '..'
import type { Unit } from '../../types'
import { classicalMap as map } from '../../maps/classical'

// One rule in every phase: a power may only order its own units (and build only on its
// own centers). The Edge Function also forces each order's nation to its row's, so this
// is the engine's own guarantee, not the only one.
const A = (nation: string, territory: string): Unit => ({ type: 'army', nation, territory })
const result = (r: ReturnType<typeof adjudicate>, source: string) =>
  r.results.find((x) => (x.order as { source: string }).source === source)

describe('ordering another power', () => {
  it('voids a movement order for a foreign unit, which then holds', () => {
    const board = boardFromUnits(map, [A('france', 'PAR')], 1901, 'Spring', 'movement')
    const r = adjudicate(map, board, [{ type: 'Move', nation: 'germany', source: 'PAR', target: 'BUR' } as AnyOrder])
    expect(result(r, 'PAR')?.code).toBe('void')
    expect(r.newBoardState.units).toEqual([expect.objectContaining({ nation: 'france', territory: 'PAR' })])
  })

  it('voids a retreat order for a foreign dislodged unit', () => {
    const board = boardFromUnits(map, [A('germany', 'MUN')], 1901, 'Spring', 'retreat')
    board.dislodged = [{ unit: A('france', 'BUR'), attackedFrom: 'MAR' }]
    const r = adjudicate(map, board, [{ type: 'Retreat', nation: 'germany', source: 'BUR', target: 'PIC' } as AnyOrder])
    expect(r.results.some((x) => x.code === 'void' && x.reason === "ordering another power's unit")).toBe(true)
    expect(r.newBoardState.units.some((u) => u.nation === 'france')).toBe(false) // unordered: disbanded
  })

  it('voids a build-phase removal of a foreign unit', () => {
    const board = boardFromUnits(map, [A('france', 'PAR'), A('france', 'BUR'), A('germany', 'MUN')], 1901, 'Fall', 'build')
    board.supplyCenters = { PAR: 'france', MUN: 'germany' } // France owes one removal
    const r = adjudicate(map, board, [{ type: 'Remove', nation: 'germany', source: 'PAR' } as AnyOrder])
    expect(r.newBoardState.units.some((u) => u.nation === 'germany' && u.territory === 'MUN')).toBe(true)
    expect(r.newBoardState.units.filter((u) => u.nation === 'france')).toHaveLength(1) // France's own disorder removal
  })
})
