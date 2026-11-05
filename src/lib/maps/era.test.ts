import { describe, expect, it } from 'vitest'
import { mapEra } from './era'

// The movement graph is read off the drawn board (tools/variants/era/build.mjs). These are the
// examples and clarifications the Era of Empire rulebook gives, so a re-trace that breaks one
// fails here.
const T = mapEra.territories
const fleet = (id: string) => T[id].fleetAdjacent ?? T[id].adjacent

describe('Era of Empire board', () => {
  it('has the rulebook province and center counts', () => {
    const all = Object.values(T)
    expect(all.length).toBe(109)
    expect(all.filter((t) => t.type === 'sea').length).toBe(23)
    expect(all.filter((t) => t.supplyCenter).length).toBe(50)
    expect(mapEra.victoryCenters).toBe(22)
    expect(mapEra.startingYear).toBe(1870)
  })

  it('starts every power on its home centers', () => {
    expect(mapEra.startingUnits.length).toBe(23)
    for (const u of mapEra.startingUnits) expect(T[u.territory].homePower).toBe(u.power)
  })

  it('moves a fleet in Rangoon only along the coast (not to Bangkok)', () => {
    expect([...fleet('RAN')].sort()).toEqual(['ANS', 'BEN', 'BOB', 'MAL'])
    expect(T.RAN.adjacent).toContain('BAN')
  })

  it('lets a fleet on Kyushu reach the Yellow Sea, the Upper Pacific and Kyoto', () => {
    expect([...fleet('KYU')].sort()).toEqual(['KYO', 'UPO', 'YS'])
  })

  it('treats Egypt as one province on both sides of the Suez Canal', () => {
    const land = T.EGY.adjacent.filter((id) => T[id].type !== 'sea').sort()
    expect(land).toEqual(['MEC', 'SUD', 'SYR'])
    expect([...fleet('EGY')].sort()).toEqual(['MEC', 'MS', 'RS', 'SUD', 'SYR'])
  })

  it('joins Cebu to Manila and Davao', () => {
    expect(T.CEB.type).toBe('coast')
    expect(fleet('CEB')).toEqual(expect.arrayContaining(['MNA', 'DAV']))
  })

  it('keeps Nepal and Tibet apart across the Himalayas', () => {
    expect(T.NEP.adjacent).not.toContain('TIB')
  })

  it('borders Mongolia from Irkutsk and Peking (standoff example)', () => {
    expect(T.IRK.adjacent).toContain('MON')
    expect(T.PEK.adjacent).toContain('MON')
  })

  it('crosses every straits arrow by army and fleet', () => {
    for (const [a, b] of [['CON', 'ANG'], ['MAD', 'CEY'], ['VLA', 'SAK'], ['SAK', 'OTA'], ['OTA', 'AKI'], ['KYO', 'KYU'], ['CAN', 'HK'], ['MAL', 'SIG'], ['MNA', 'CEB'], ['CEB', 'DAV']]) {
      expect(T[a].adjacent).toContain(b)
      expect(fleet(a)).toContain(b)
    }
  })
})
