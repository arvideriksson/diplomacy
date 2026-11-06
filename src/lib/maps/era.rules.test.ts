import { describe, expect, it } from 'vitest'
import { adjudicate, boardFromUnits, idleNations } from '../adjudicator'
import type { AnyOrder, BoardState } from '../adjudicator'
import { victoryFor } from '../adjudicator/resolve'
import { supplyCenterProvinces } from '../adjudicator/state'
import type { MapDefinition } from '../mapDefinition'
import type { Unit } from '../types'
import { mapEra } from './era'

// The Era of Empire rulebook's Winter rules (conscription, conversion) and its victory rule,
// using the rulebook's own examples where it gives one.
const A = (nation: string, territory: string): Unit => ({ type: 'army', nation, territory })
const F = (nation: string, territory: string): Unit => ({ type: 'fleet', nation, territory })
const winter = (units: Unit[], owners: Record<string, string>): BoardState => {
  const b = boardFromUnits(mapEra, units, 1870, 'Fall', 'build')
  b.supplyCenters = { ...owners }
  return b
}
const own = (nation: string, ...ids: string[]) => Object.fromEntries(ids.map((id) => [id, nation]))
const build = (nation: string, source: string, unitType: 'army' | 'fleet'): AnyOrder => ({ type: 'Build', nation, source, unitType })
const convert = (nation: string, source: string, unitType: 'army' | 'fleet'): AnyOrder => ({ type: 'Convert', nation, source, unitType })
const remove = (nation: string, source: string): AnyOrder => ({ type: 'Remove', nation, source })
const code = (r: ReturnType<typeof adjudicate>, type: string, source: string) =>
  r.results.find((x) => x.order.type === type && x.order.source === source)?.code
const at = (r: ReturnType<typeof adjudicate>, p: string) => r.newBoardState.units.find((u) => u.territory === p)
const TURKEY = [A('turkey', 'ANG'), F('turkey', 'BAG'), F('turkey', 'CON')]
const BRITAIN = [A('britain', 'DEL'), F('britain', 'MAD'), A('britain', 'BOM'), F('britain', 'ADE')]

describe('Era of Empire: conscription', () => {
  it('builds in any owned, unoccupied center (rulebook: Turkey builds in Tabriz and Egypt)', () => {
    const r = adjudicate(mapEra, winter(TURKEY, own('turkey', 'CON', 'ANG', 'BAG', 'TAB', 'EGY')), [
      build('turkey', 'TAB', 'army'),
      build('turkey', 'EGY', 'fleet'),
    ])
    expect(at(r, 'TAB')).toMatchObject({ nation: 'turkey', type: 'army' })
    expect(at(r, 'EGY')).toMatchObject({ nation: 'turkey', type: 'fleet' })
  })

  it('cannot build in a center it does not own, or one that is occupied', () => {
    const r = adjudicate(mapEra, winter([...TURKEY, A('britain', 'EGY')], { ...own('turkey', 'CON', 'ANG', 'BAG', 'TAB', 'EGY', 'SYR'), ...own('britain', 'ADE') }), [
      build('turkey', 'EGY', 'army'),
      build('turkey', 'MEC', 'army'),
    ])
    expect(code(r, 'Build', 'EGY')).toBe('void')
    expect(code(r, 'Build', 'MEC')).toBe('void')
  })

  it('still builds only fleets on coastal centers', () => {
    const r = adjudicate(mapEra, winter(TURKEY, own('turkey', 'CON', 'ANG', 'BAG', 'TAB')), [build('turkey', 'TAB', 'fleet')])
    expect(code(r, 'Build', 'TAB')).toBe('void')
  })

  it('removes in civil disorder the unit furthest from any owned center, not from home', () => {
    // Turkey owns Constantinople and Egypt and must lose one of three units. Egypt is no
    // home center, but it is owned: the army off every center goes.
    const r = adjudicate(mapEra, winter([F('turkey', 'CON'), A('turkey', 'EGY'), A('turkey', 'ARM')], own('turkey', 'CON', 'EGY')), [])
    expect(at(r, 'ARM')).toBeUndefined()
    expect(at(r, 'EGY')?.nation).toBe('turkey')
  })
})

describe('Era of Empire: conversion', () => {
  it('converts a fleet that took a center into an army (rulebook: Britain, Sudan)', () => {
    const r = adjudicate(mapEra, winter([...BRITAIN, F('britain', 'SUD')], own('britain', 'DEL', 'MAD', 'BOM', 'ADE', 'SUD')), [convert('britain', 'SUD', 'army')])
    expect(code(r, 'Convert', 'SUD')).toBe('succeeds')
    expect(at(r, 'SUD')?.type).toBe('army')
  })

  it('converts with no builds owed, but not an army inland (rulebook: Bengal yes, Delhi no)', () => {
    const r = adjudicate(mapEra, winter([...BRITAIN, A('britain', 'BEN')], own('britain', 'DEL', 'MAD', 'BOM', 'ADE', 'BEN')), [
      convert('britain', 'BEN', 'fleet'),
      convert('britain', 'DEL', 'fleet'),
    ])
    expect(at(r, 'BEN')?.type).toBe('fleet')
    expect(code(r, 'Convert', 'DEL')).toBe('void')
    expect(at(r, 'DEL')?.type).toBe('army')
  })

  it('does not use a build: a power converts and builds in the same winter', () => {
    const r = adjudicate(mapEra, winter(BRITAIN, own('britain', 'DEL', 'MAD', 'BOM', 'ADE', 'BEN')), [
      convert('britain', 'BOM', 'fleet'),
      build('britain', 'BEN', 'army'),
    ])
    expect(at(r, 'BOM')?.type).toBe('fleet')
    expect(at(r, 'BEN')?.type).toBe('army')
  })

  it('needs a unit on a center its power owns, of the other type', () => {
    const r = adjudicate(mapEra, winter([...BRITAIN, A('britain', 'RAJ')], own('britain', 'DEL', 'MAD', 'BOM', 'ADE', 'BEN')), [
      convert('britain', 'RAJ', 'fleet'), // not a center
      convert('britain', 'MAD', 'fleet'), // already a fleet
      convert('britain', 'BEN', 'army'), // no unit there
    ])
    expect(code(r, 'Convert', 'RAJ')).toBe('void')
    expect(code(r, 'Convert', 'MAD')).toBe('void')
    expect(code(r, 'Convert', 'BEN')).toBe('void')
  })

  it('cannot convert a unit that is removed, or one just built', () => {
    const r = adjudicate(mapEra, winter(BRITAIN, own('britain', 'DEL', 'MAD', 'BOM')), [remove('britain', 'ADE'), convert('britain', 'ADE', 'army')])
    expect(code(r, 'Convert', 'ADE')).toBe('void')
    expect(at(r, 'ADE')).toBeUndefined()
    const r2 = adjudicate(mapEra, winter(BRITAIN, own('britain', 'DEL', 'MAD', 'BOM', 'ADE', 'BEN')), [build('britain', 'BEN', 'army'), convert('britain', 'BEN', 'fleet')])
    expect(at(r2, 'BEN')?.type).toBe('army')
  })

  it('is not allowed on a map without the rule', () => {
    const plain: MapDefinition = { ...mapEra, rules: {} }
    const b = winter(BRITAIN, own('britain', 'DEL', 'MAD', 'BOM', 'ADE'))
    const r = adjudicate(plain, b, [convert('britain', 'BOM', 'fleet')])
    expect(code(r, 'Convert', 'BOM')).toBe('void')
  })

  it('opens a winter whenever a unit could convert, even with nothing owed', () => {
    const fall = boardFromUnits(mapEra, BRITAIN, 1870, 'Fall', 'movement')
    fall.supplyCenters = own('britain', 'DEL', 'MAD', 'BOM', 'ADE')
    expect(adjudicate(mapEra, fall, []).newBoardState.phase).toBe('build')
    expect(adjudicate({ ...mapEra, rules: {} }, fall, []).newBoardState.phase).toBe('movement')
  })

  it('keeps a power that could convert from being auto-readied', () => {
    const b = winter([...BRITAIN, A('china', 'SIN')], { ...own('britain', 'DEL', 'MAD', 'BOM', 'ADE'), ...own('china', 'SIN') })
    const idle = idleNations(mapEra, b)
    expect(idle).not.toContain('britain') // armies in Bombay, fleets in Madras and Aden could switch
    expect(idle).toContain('china') // an army inland on its only center: nothing to do
  })
})

describe('Era of Empire: victory', () => {
  const centers = supplyCenterProvinces(mapEra)
  it('needs 22 centers', () => {
    expect(victoryFor(mapEra, own('britain', ...centers.slice(0, 21)))).toBeUndefined()
    expect(victoryFor(mapEra, own('britain', ...centers.slice(0, 22)))).toMatchObject({ nation: 'britain', centers: 22 })
  })
  it('goes to the power with the most centers when two reach 22', () => {
    const v = victoryFor(mapEra, { ...own('china', ...centers.slice(0, 22)), ...own('britain', ...centers.slice(22, 45)) })
    expect(v).toEqual({ nation: 'britain', centers: 23 })
  })
  it('is shared by powers tied for the most', () => {
    const v = victoryFor(mapEra, { ...own('china', ...centers.slice(0, 22)), ...own('britain', ...centers.slice(22, 44)) })
    expect(v).toEqual({ nation: 'britain', centers: 22, shared: ['britain', 'china'] })
  })
})
