import { describe, expect, it } from 'vitest'
import { adjudicate, initialBoard } from '../adjudicator'
import { map1900 } from './1900'

// Exercise the generated variant through the same setup path used by games and sandboxes.
describe('1900 opening board', () => {
  it('starts in Spring 1900 with the variant overseas and dummy centers', () => {
    const board = initialBoard(map1900)
    expect(board.year).toBe(1900)
    expect(map1900.victoryCenters).toBe(18)
    expect(board.units).toHaveLength(25)
    expect(board.supplyCenters.ALG).toBe('france')
    expect(board.supplyCenters.EGY).toBe('britain')
    expect(board.supplyCenters.DUM).toBe('russia')
    expect(board.units).toContainEqual({ type: 'fleet', nation: 'russia', territory: 'STP', coast: 'sc' })
  })

  it('retains the three Spanish coasts and the Portugal sea connection', () => {
    expect(Object.keys(map1900.territories.SPA.coasts ?? {})).toEqual(['nc', 'ec', 'wc'])
    expect(map1900.territories.POR.adjacent).toContain('MAO')
    expect(map1900.territories.POR.adjacent).toContain('SPA')
  })

  it('awards victory at the source variant’s 18-center target', () => {
    const board = initialBoard(map1900)
    const centers = Object.keys(map1900.territories).filter((id) => id !== 'DUM' && map1900.territories[id].supplyCenter)
    board.supplyCenters = {}
    for (const id of centers.slice(0, 18)) board.supplyCenters[id] = 'britain'
    expect(adjudicate(map1900, board, []).victory).toEqual({ nation: 'britain', centers: 18 })
  })
})
