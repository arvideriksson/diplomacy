import { describe, expect, it } from 'vitest'
import { expandUuid, shortenUuid } from '../shortId'

describe('shortId', () => {
  it('round-trips UUIDs at a fixed 22 characters', () => {
    for (const uuid of [
      'dfe6b3f0-46cc-4ca6-9cf4-d8a049711d40',
      '00000000-0000-0000-0000-000000000000',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
      crypto.randomUUID(),
    ]) {
      const short = shortenUuid(uuid)
      expect(short).toMatch(/^[0-9A-Za-z]{22}$/)
      expect(expandUuid(short)).toBe(uuid)
    }
  })
  it('passes full UUIDs and unknown ids through', () => {
    expect(expandUuid('dfe6b3f0-46cc-4ca6-9cf4-d8a049711d40')).toBe('dfe6b3f0-46cc-4ca6-9cf4-d8a049711d40')
    expect(expandUuid('nope')).toBe('nope')
    expect(expandUuid('zzzzzzzzzzzzzzzzzzzzzz')).toBe('zzzzzzzzzzzzzzzzzzzzzz')
  })
})
