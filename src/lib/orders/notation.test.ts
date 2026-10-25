import { describe, expect, it } from 'vitest'
import { classicalMap as map } from '../maps/classical'
import { describeAnyOrder } from './notation'

describe('describeAnyOrder', () => {
  it('spells orders out with full province names', () => {
    expect(describeAnyOrder(map, { type: 'Move', nation: 'england', source: 'LON', target: 'ENG' })).toBe('London → English Channel')
    expect(describeAnyOrder(map, { type: 'Support', nation: 'england', source: 'EDI', aux: 'LON', target: 'NTH' })).toBe(
      'Edinburgh supports London → North Sea',
    )
    expect(describeAnyOrder(map, { type: 'Support', nation: 'england', source: 'EDI', aux: 'LON', target: 'LON' })).toBe(
      'Edinburgh supports London holding',
    )
    expect(describeAnyOrder(map, { type: 'Hold', nation: 'england', source: 'LVP' })).toBe('Liverpool holds')
  })

  it('names coasts and build unit types', () => {
    expect(describeAnyOrder(map, { type: 'Build', nation: 'russia', source: 'STP', sourceCoast: 'sc', unitType: 'fleet' })).toMatch(
      /^Build a fleet in St\. Petersburg \(South/,
    )
  })
})
