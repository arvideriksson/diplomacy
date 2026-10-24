import { describe, expect, it } from 'vitest'
import { adjudicate, boardFromUnits, idleNations } from '../adjudicator'
import type { AnyOrder, BoardState } from '../adjudicator'
import type { Unit } from '../types'
import { map1900 } from './1900'

// One test per rule on the vDiplomacy 1900 rules page.
const A = (nation: string, territory: string): Unit => ({ type: 'army', nation, territory })
const F = (nation: string, territory: string, coast?: string): Unit => ({ type: 'fleet', nation, territory, ...(coast ? { coast } : {}) })
const board = (units: Unit[], owners: Record<string, string> = {}, season: 'Spring' | 'Fall' = 'Spring'): BoardState => {
  const b = boardFromUnits(map1900, units, 1901, season, 'movement')
  b.supplyCenters = { ...owners }
  return b
}
const move = (nation: string, source: string, target: string, extra: object = {}): AnyOrder => ({ type: 'Move', nation, source, target, ...extra }) as AnyOrder
const support = (nation: string, source: string, aux: string, target?: string): AnyOrder => ({ type: 'Support', nation, source, aux, ...(target ? { target } : {}) }) as AnyOrder
const convoy = (nation: string, source: string, aux: string, target: string): AnyOrder => ({ type: 'Convoy', nation, source, aux, target }) as AnyOrder
const code = (r: ReturnType<typeof adjudicate>, source: string) => r.results.find((x) => (x.order as { source: string }).source === source)?.code
const at = (r: ReturnType<typeof adjudicate>, p: string) => r.newBoardState.units.find((u) => u.territory === p)

describe('1900 geography', () => {
  it('armies move between Clyde and Ireland without a convoy, even past an enemy fleet', () => {
    const r = adjudicate(map1900, board([A('britain', 'CLY'), F('france', 'NAO')]), [move('britain', 'CLY', 'IRE')])
    expect(at(r, 'IRE')?.nation).toBe('britain')
  })
  it('armies move between Gibraltar and Morocco without a convoy', () => {
    const r = adjudicate(map1900, board([A('britain', 'GIB')]), [move('britain', 'GIB', 'MOR')])
    expect(at(r, 'MOR')?.nation).toBe('britain')
  })
  it('a fleet in Gibraltar can convoy an army (Spain to Morocco is not a direct move)', () => {
    expect(map1900.territories.SPA.adjacent).not.toContain('MOR')
    const r = adjudicate(map1900, board([A('france', 'SPA'), F('france', 'GIB')]), [move('france', 'SPA', 'MOR'), convoy('france', 'GIB', 'SPA', 'MOR')])
    expect(at(r, 'MOR')?.type).toBe('army')
  })
  it('Gibraltar can be a convoyed army’s destination', () => {
    const r = adjudicate(map1900, board([A('france', 'POR'), F('france', 'MAO')]), [move('france', 'POR', 'GIB'), convoy('france', 'MAO', 'POR', 'GIB')])
    expect(code(r, 'POR')).toBe('succeeds')
  })
  it('a fleet in Gibraltar connects the Mid-Atlantic and Western Mediterranean', () => {
    expect(map1900.territories.GIB.fleetAdjacent).toEqual(expect.arrayContaining(['MAO', 'WES']))
  })
})

describe('1900 Suez Canal rules', () => {
  it('1. fleets move between Egypt and Hejaz', () => {
    const r = adjudicate(map1900, board([F('britain', 'EGY')]), [move('britain', 'EGY', 'HEJ')])
    expect(at(r, 'HEJ')?.type).toBe('fleet')
  })
  it('2. fleets move between Egypt/Hejaz and the Mid-Atlantic', () => {
    const r = adjudicate(map1900, board([F('britain', 'HEJ')]), [move('britain', 'HEJ', 'MAO')])
    expect(at(r, 'MAO')?.nation).toBe('britain')
  })
  it('3. a long-route move loses a standoff to an ordinary one', () => {
    const r = adjudicate(map1900, board([F('britain', 'MAO'), F('turkey', 'EAS')]), [move('britain', 'MAO', 'EGY'), move('turkey', 'EAS', 'EGY')])
    expect(at(r, 'EGY')?.nation).toBe('turkey')
    const r2 = adjudicate(map1900, board([F('britain', 'EGY'), F('france', 'NAO')]), [move('britain', 'EGY', 'MAO'), move('france', 'NAO', 'MAO')])
    expect(at(r2, 'MAO')?.nation).toBe('france')
  })
  it('3. a long-route move into an empty province still succeeds, and cannot dislodge a holding unit alone', () => {
    const r = adjudicate(map1900, board([F('britain', 'MAO'), A('turkey', 'EGY')]), [move('britain', 'MAO', 'EGY')])
    expect(at(r, 'EGY')?.nation).toBe('turkey')
  })
  it('4. a fleet in Egypt cannot support into the Mid-Atlantic', () => {
    const r = adjudicate(map1900, board([F('britain', 'EGY'), F('britain', 'NAO'), F('france', 'MAO')]), [move('britain', 'NAO', 'MAO'), support('britain', 'EGY', 'NAO', 'MAO')])
    expect(code(r, 'EGY')).toBe('void')
    expect(at(r, 'MAO')?.nation).toBe('france')
  })
  it('5. a fleet in the Mid-Atlantic cannot support a hold in Hejaz', () => {
    const r = adjudicate(map1900, board([F('britain', 'MAO'), A('britain', 'HEJ'), A('turkey', 'PAL'), A('turkey', 'ARA')]), [support('britain', 'MAO', 'HEJ'), move('turkey', 'PAL', 'HEJ'), support('turkey', 'ARA', 'PAL', 'HEJ')])
    expect(code(r, 'MAO')).toBe('void')
    expect(at(r, 'HEJ')?.nation).toBe('turkey')
  })
  it('6. a long-route attack does not cut support unless it dislodges', () => {
    // F Egy supports A Hej -> Pal; French F Mao attacks Egy around Africa: support stands.
    const r = adjudicate(map1900, board([F('britain', 'EGY'), A('britain', 'HEJ'), A('turkey', 'PAL'), F('france', 'MAO')]), [support('britain', 'EGY', 'HEJ', 'PAL'), move('britain', 'HEJ', 'PAL'), move('france', 'MAO', 'EGY')])
    expect(code(r, 'EGY')).toBe('succeeds')
    expect(r.newBoardState.dislodged.map((d) => d.unit.territory)).toContain('PAL')
  })
  it('7. an army convoyed into Egypt only around Africa attacks at half strength', () => {
    const r = adjudicate(map1900, board([A('france', 'POR'), F('france', 'MAO'), A('turkey', 'PAL')]), [move('france', 'POR', 'EGY'), convoy('france', 'MAO', 'POR', 'EGY'), move('turkey', 'PAL', 'EGY')])
    expect(at(r, 'EGY')?.nation).toBe('turkey')
  })
  it('7. an army convoyed out of Egypt attacks at full strength', () => {
    const r = adjudicate(map1900, board([A('britain', 'EGY'), F('britain', 'MAO'), A('france', 'GAS')]), [move('britain', 'EGY', 'POR'), convoy('britain', 'MAO', 'EGY', 'POR'), move('france', 'GAS', 'SPA')])
    expect(at(r, 'POR')?.nation).toBe('britain')
  })
  it('8. an ordinary retreat beats a retreat around Africa', () => {
    const b = board([F('britain', 'MAO'), F('france', 'EAS')])
    b.phase = 'retreat'
    b.units = []
    b.dislodged = [{ unit: F('britain', 'MAO'), attackedFrom: 'NAO' }, { unit: F('france', 'EAS'), attackedFrom: 'ION' }]
    const r = adjudicate(map1900, b, [{ type: 'Retreat', nation: 'britain', source: 'MAO', target: 'EGY' } as AnyOrder, { type: 'Retreat', nation: 'france', source: 'EAS', target: 'EGY' } as AnyOrder])
    expect(r.newBoardState.units.find((u) => u.territory === 'EGY')?.nation).toBe('france')
  })
})

describe('1900 adjustments and victory', () => {
  const homes = { STP: 'russia', MOS: 'russia', WAR: 'russia', SEV: 'russia' }
  const fall = (units: Unit[], owners: Record<string, string>) => {
    const b = board(units, owners, 'Fall')
    return adjudicate(map1900, b, [])
  }
  it('Egypt and Algeria are not build sites', () => {
    const b = board([], { EGY: 'britain', ALG: 'france', LON: 'britain' })
    b.phase = 'build'
    const r = adjudicate(map1900, b, [{ type: 'Build', nation: 'britain', source: 'EGY', unitType: 'fleet' } as AnyOrder])
    expect(code(r, 'EGY')).toBe('void')
  })
  it('Russia keeps one extra unit while holding some but not all home centers', () => {
    const r = fall([A('russia', 'MOS'), A('russia', 'WAR'), A('russia', 'UKR'), A('russia', 'LVO')], { MOS: 'russia', WAR: 'russia', RUM: 'russia' })
    // 3 centers + emergency allowance = 4 units: no adjustment owed.
    expect(r.newBoardState.phase).toBe('movement')
  })
  it('Russia may build in Siberia under emergency measures, never when it holds all four homes', () => {
    const b = board([A('russia', 'MOS'), A('russia', 'WAR')], { MOS: 'russia', WAR: 'russia', STP: 'germany', RUM: 'russia', SWE: 'russia' })
    b.phase = 'build'
    const r = adjudicate(map1900, b, [{ type: 'Build', nation: 'russia', source: 'SIB', unitType: 'army' } as AnyOrder])
    expect(code(r, 'SIB')).toBe('succeeds')
    const b2 = board([A('russia', 'MOS')], { ...homes, RUM: 'russia' })
    b2.phase = 'build'
    const r2 = adjudicate(map1900, b2, [{ type: 'Build', nation: 'russia', source: 'SIB', unitType: 'army' } as AnyOrder])
    expect(code(r2, 'SIB')).toBe('void')
  })
  it('Russia is not auto-readied when Siberia is its only build site', () => {
    // Russia holds Moscow (occupied) and Warsaw (occupied) of its homes, plus Rumania: allowance 3 + 1.
    const b = board([A('russia', 'MOS'), A('russia', 'WAR'), A('germany', 'STP'), F('turkey', 'SEV')], { MOS: 'russia', WAR: 'russia', RUM: 'russia', STP: 'germany', SEV: 'turkey' })
    b.phase = 'build'
    expect(idleNations(map1900, b)).not.toContain('russia')
  })
  it('Siberia is never a supply center', () => {
    expect(map1900.territories.SIB.supplyCenter).toBe(false)
  })
  it('Egypt counts as a British home center for civil-disorder removals', () => {
    // Britain owes one removal and orders none: the unit far from London AND Egypt goes.
    const b = board([F('britain', 'EGY'), F('britain', 'BAR')], { LON: 'britain' })
    b.phase = 'build'
    const r = adjudicate(map1900, b, [])
    expect(r.newBoardState.units.map((u) => u.territory)).toEqual(['EGY'])
  })
  it('two powers tied at 18+ centers: no winner; the larger of two 18+ powers wins', () => {
    const ids = Object.keys(map1900.territories).filter((id) => map1900.territories[id].supplyCenter)
    const owners: Record<string, string> = {}
    ids.slice(0, 18).forEach((id) => (owners[id] = 'britain'))
    ids.slice(18, 36).forEach((id) => (owners[id] = 'france'))
    const b = board([], owners)
    expect(adjudicate(map1900, b, []).victory).toBeUndefined()
    owners[ids[36]] = 'france'
    expect(adjudicate(map1900, board([], owners), []).victory).toEqual({ nation: 'france', centers: 19 })
  })
})

describe('1900 emergency measures transitions', () => {
  it('a Russia that regains all four home centers must disband its extra unit', () => {
    // 5 centers incl. all 4 homes, but 6 units (it had the emergency allowance last year).
    const units = [A('russia', 'MOS'), A('russia', 'WAR'), F('russia', 'SEV'), A('russia', 'STP'), A('russia', 'UKR'), A('russia', 'SIB')]
    const b = board(units, { MOS: 'russia', WAR: 'russia', SEV: 'russia', STP: 'russia', RUM: 'russia' }, 'Fall')
    const r = adjudicate(map1900, b, [])
    expect(r.newBoardState.phase).toBe('build')
    const r2 = adjudicate(map1900, r.newBoardState, [])
    expect(r2.newBoardState.units.filter((u) => u.nation === 'russia')).toHaveLength(5)
  })
  it('a Russia with no home centers left gets no extra unit', () => {
    const b = board([A('russia', 'UKR'), A('russia', 'LVO')], { RUM: 'russia', MOS: 'germany', WAR: 'germany', STP: 'germany', SEV: 'turkey' }, 'Fall')
    const r = adjudicate(map1900, b, [])
    expect(r.newBoardState.phase).toBe('build')
    const r2 = adjudicate(map1900, r.newBoardState, [])
    expect(r2.newBoardState.units.filter((u) => u.nation === 'russia')).toHaveLength(1)
  })
  it('a unit standing in Siberia never claims it as a center', () => {
    const b = board([A('germany', 'SIB')], { BER: 'germany' }, 'Fall')
    const r = adjudicate(map1900, b, [])
    expect(r.newBoardState.supplyCenters.SIB).toBeUndefined()
  })
})

describe('order ownership', () => {
  it("an order naming another power's unit voids and cannot displace that power's own order", () => {
    // Britain's real order holds Paris' attacker off; a forged French-named order from
    // "Britain" (after the server stamps the row's nation) must not move France's army.
    const units = [A('france', 'PAR'), A('germany', 'BUR')]
    const forged = { ...move('britain', 'PAR', 'PIC') } // stamped with the row's nation
    const r = adjudicate(map1900, board(units), [move('france', 'PAR', 'GAS'), forged])
    expect(at(r, 'GAS')?.nation).toBe('france')
    const r2 = adjudicate(map1900, board(units), [forged, move('france', 'PAR', 'GAS')])
    expect(at(r2, 'GAS')?.nation).toBe('france')
  })
  it("another power cannot retreat or disband your dislodged unit", () => {
    const b = board([])
    b.phase = 'retreat'
    b.dislodged = [{ unit: A('france', 'PAR'), attackedFrom: 'BUR' }]
    const real = { type: 'Retreat', nation: 'france', source: 'PAR', target: 'GAS' } as AnyOrder
    const forged = { type: 'Disband', nation: 'germany', source: 'PAR' } as AnyOrder
    for (const orders of [[forged, real], [real, forged]]) {
      expect(adjudicate(map1900, b, orders).newBoardState.units.find((u) => u.territory === 'GAS')?.nation).toBe('france')
    }
    // a forged order alone must not disband it either (no order: it is disbanded as unordered,
    // so check instead that a forged retreat elsewhere does not move it)
    const r = adjudicate(map1900, b, [{ type: 'Retreat', nation: 'germany', source: 'PAR', target: 'PIC' } as AnyOrder])
    expect(r.newBoardState.units.find((u) => u.territory === 'PIC')).toBeUndefined()
  })
})
