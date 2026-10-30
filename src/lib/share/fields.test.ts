import { expect, it } from 'vitest'
import { classicalMap } from '../maps/classical'
import { map1900 } from '../maps/1900'
import type { MapDefinition } from '../mapDefinition'
import { decode, encode, fixedBits } from './bits'
import { coastCodec, countryCodec, optionalPlace, provinceCodec, unitCodec } from './fields'
import { CoastKind, PowerKind, UnitKind, WireBit, WireSize } from './wire'

const INVALID_CODE = 0xff
const VALID_WIDTH = 3
const INVALID_WIDTH = -1

function context(map: MapDefinition) {
  const provinces = Object.keys(map.territories).sort()
  const provinceBits = Math.ceil(Math.log2(provinces.length))
  return { map, provinces, provinceBits }
}

it('uses map context to translate England and Britain without changing the bits', () => {
  const classical = context(classicalMap)
  const variant = context(map1900)
  const english = encode(countryCodec, PowerKind.England, classical)
  const british = encode(countryCodec, PowerKind.Britain, variant)
  expect(english.bitLength).toBe(WireSize.Power)
  expect(english.bytes).toEqual(british.bytes)
  expect(decode(countryCodec, english.bytes, classical)).toBe(PowerKind.England)
  expect(decode(countryCodec, british.bytes, variant)).toBe(PowerKind.Britain)
})

it('round trips map-dependent unit fields, including western coasts', () => {
  const variant = context(map1900)
  const unit = { nation: PowerKind.France, type: UnitKind.Fleet, territory: 'SPA', coast: CoastKind.West }
  const payload = encode(unitCodec, unit, variant)
  expect(decode(unitCodec, payload.bytes, variant)).toEqual(unit)
})

it('rejects unknown province and coast codes', () => {
  const variant = context(map1900)
  const invalid = Uint8Array.of(INVALID_CODE)
  expect(() => decode(provinceCodec, invalid, variant)).toThrow()
  expect(() => decode(coastCodec, invalid, variant)).toThrow()
  expect(() => encode(provinceCodec, 'UNKNOWN', variant)).toThrow()
})

it('distinguishes absent optional provinces from present ones', () => {
  const classical = context(classicalMap)
  const absent = encode(optionalPlace, undefined, classical)
  const present = encode(optionalPlace, 'PAR', classical)
  expect(absent.bitLength).toBe(WireBit.One)
  expect(decode(optionalPlace, absent.bytes, classical)).toBeUndefined()
  expect(decode(optionalPlace, present.bytes, classical)).toBe('PAR')
})

it('checks fixed-width definitions and encoded values', () => {
  const value = fixedBits<number, number>({
    size: (width) => width,
    encode: (number) => number,
    decode: (number) => number,
  })
  expect(() => encode(value, WireBit.One, INVALID_WIDTH)).toThrow()
  expect(() => encode(value, INVALID_CODE, VALID_WIDTH)).toThrow()
  expect(() => decode(value, new Uint8Array(), VALID_WIDTH)).toThrow()
})
