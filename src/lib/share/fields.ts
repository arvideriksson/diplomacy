import type { Unit } from '../types'
import type { MapDefinition } from '../mapDefinition'
import { fixedBits, literal, struct, type Codec } from './bits'
import {
  COAST_IDS,
  POWER_IDS,
  CoastKind,
  MapKind,
  PowerCode,
  PowerKind,
  UnitKind,
  WireBit,
  WireSize,
  requireWire,
} from './wire'

/** The map-dependent dictionaries used by the version 1 field codecs. */
export interface FieldContext {
  map: MapDefinition
  provinces: string[]
  provinceBits: number
}

function encodeCountry(country: string): number {
  const power = country === PowerKind.Britain ? PowerKind.England : country
  return power === PowerKind.Neutral ? PowerCode.Neutral : POWER_IDS.findIndex((entry) => entry === power)
}

function decodeCountry(code: number, context: FieldContext): string {
  const country = POWER_IDS[code] ?? PowerKind.Neutral
  if (context.map.id === MapKind.Variant1900 && country === PowerKind.England) return PowerKind.Britain
  return country
}

export const countryCodec = fixedBits<string, FieldContext>({
  size: WireSize.Power,
  encode: encodeCountry,
  decode: decodeCountry,
})

export const provinceCodec = fixedBits<string, FieldContext>({
  size: (context) => context.provinceBits,
  encode: (province, context) => context.provinces.indexOf(province),
  decode: (code, context) => {
    const province = context.provinces[code]
    requireWire(province)
    return province
  },
})

export const optionalPlace: Codec<string | undefined, FieldContext> = {
  read(reader, context) {
    if (reader.uint(WireBit.One)) return provinceCodec.read(reader, context)
    return undefined
  },
  write(writer, province, context) {
    writer.uint(province ? WireBit.One : WireBit.Zero, WireBit.One)
    if (province) provinceCodec.write(writer, province, context)
  },
}

function coastChoices(context: FieldContext): Array<string | undefined> {
  if (context.map.id === MapKind.Variant1900) return [...COAST_IDS, CoastKind.West]
  return [...COAST_IDS]
}

export const coastCodec = fixedBits<string | undefined, FieldContext>({
  size: (context) => Math.ceil(Math.log2(coastChoices(context).length)),
  encode: (coast, context) => coastChoices(context).indexOf(coast),
  decode: (code, context) => {
    const choices = coastChoices(context)
    requireWire(code < choices.length)
    return choices[code]
  },
})

const unitType = fixedBits<Unit['type'], FieldContext>({
  size: WireBit.One,
  encode: (type) => (type === UnitKind.Fleet ? WireBit.One : WireBit.Zero),
  decode: (code) => (code ? UnitKind.Fleet : UnitKind.Army),
})

const unitFields = struct<FieldContext>()
  .field('nation', countryCodec)
  .field('type', unitType)
  .field('territory', provinceCodec)
  .field('coast', (_context, unit) =>
    unit.type === UnitKind.Fleet ? coastCodec : literal<string | undefined, FieldContext>(undefined),
  )

/** An army omits the coast property; fleets include it only when specified. */
export const unitCodec: Codec<Unit, FieldContext> = {
  read(reader, context) {
    const { coast, ...unit } = unitFields.read(reader, context)
    return coast ? { ...unit, coast } : unit
  },
  write(writer, unit, context) {
    unitFields.write(writer, { ...unit, coast: unit.type === UnitKind.Fleet ? unit.coast : undefined }, context)
  },
}
