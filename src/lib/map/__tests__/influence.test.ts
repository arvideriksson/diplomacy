import { describe, expect, it } from 'vitest'
import { classicalMap } from '../../maps'
import { influencedProvinces } from '../influence'

const homeCenters = Object.fromEntries(
  Object.entries(classicalMap.territories)
    .filter(([, t]) => t.homePower)
    .map(([id, t]) => [id, t.homePower!]),
)

describe('influencedProvinces', () => {
  it('paints a province where one power owns a majority of the adjacent centers', () => {
    const influenced = influencedProvinces(classicalMap, homeCenters)
    expect(influenced.GAS).toBe('france') // Bre, Par, Mar of Bre/Par/Mar/Spa
    expect(influenced.YOR).toBe('england')
    expect(influenced.SYR).toBe('turkey') // Smy, its only adjacent center
  })

  it('leaves exactly half, ties, supply centers and seas unpainted', () => {
    const influenced = influencedProvinces(classicalMap, homeCenters)
    expect(influenced.GAL).toBeUndefined() // Vie + Bud of Vie/Bud/War/Rum
    expect(influenced.BUR).toBeUndefined() // Par + Mar of Par/Mar/Bel/Mun
    expect(influenced.BOH).toBeUndefined() // Mun vs Vie
    expect(influenced.PAR).toBeUndefined()
    expect(influenced.NTH).toBeUndefined()
  })

  it('paints a province once its owner takes a majority', () => {
    const influenced = influencedProvinces(classicalMap, { ...homeCenters, BEL: 'france' })
    expect(influenced.BUR).toBe('france')
  })
})
