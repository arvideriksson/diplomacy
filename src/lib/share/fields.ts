import type { Unit } from '../types'
import type { BoardState } from '../adjudicator'
import type { MapDefinition } from '../mapDefinition'
import { fixedBitsCodec, literal, struct, type Codec } from './bits'
import {
  COAST_IDS,
  EMPTY_TEXT,
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

/** A power must belong to the active map; neutral is a wire-only owner value. */
function validCountry(country: string, map: MapDefinition): boolean {
  return map.powers.some((power) => power.id === country)
}

function validProvince(province: string, map: MapDefinition): boolean {
  return Boolean(map.territories[province])
}

export const countryCodec = Object.assign(
  fixedBitsCodec<string, FieldContext>({
    size: WireSize.Power,
    encode: (country, context) => {
      requireWire(country === PowerKind.Neutral || validCountry(country, context.map))
      const power = country === PowerKind.Britain ? PowerKind.England : country
      return power === PowerKind.Neutral ? PowerCode.Neutral : POWER_IDS.findIndex((entry) => entry === power)
    },
    decode: (code, context) => {
      const country: string = POWER_IDS[code] ?? PowerKind.Neutral
      const result =
        context.map.id === MapKind.Variant1900 && country === PowerKind.England ? PowerKind.Britain : country
      requireWire(result === PowerKind.Neutral || validCountry(result, context.map))
      return result
    },
  }),
  { validate: validCountry },
)

export const provinceCodec = Object.assign(
  fixedBitsCodec<string, FieldContext>({
    size: (context) => context.provinceBits,
    encode: (province, context) => {
      requireWire(validProvince(province, context.map))
      return context.provinces.indexOf(province)
    },
    decode: (code, context) => {
      const province = context.provinces[code]
      requireWire(province && validProvince(province, context.map))
      return province
    },
  }),
  { validate: validProvince },
)

export const optionalPlace: Codec<string | undefined, FieldContext> = {
  decode(reader, context) {
    if (reader.get(WireBit.One)) return provinceCodec.decode(reader, context)
    return undefined
  },
  encode(writer, province, context) {
    writer.put(province ? WireBit.One : WireBit.Zero, WireBit.One)
    if (province) provinceCodec.encode(writer, province, context)
  },
}

function coastChoices(context: FieldContext): Array<string | undefined> {
  if (context.map.id === MapKind.Variant1900) return [...COAST_IDS, CoastKind.West]
  return [...COAST_IDS]
}

export const coastCodec = fixedBitsCodec<string | undefined, FieldContext>({
  size: (context) => Math.ceil(Math.log2(coastChoices(context).length)),
  encode: (coast, context) => coastChoices(context).indexOf(coast),
  decode: (code, context) => {
    const choices = coastChoices(context)
    requireWire(code < choices.length)
    return choices[code]
  },
})

const unitType = fixedBitsCodec<Unit['type'], FieldContext>({
  size: WireBit.One,
  encode: (type) => (type === UnitKind.Fleet ? WireBit.One : WireBit.Zero),
  decode: (code) => (code ? UnitKind.Fleet : UnitKind.Army),
})

const unitFields = struct<FieldContext>()
  .field('nation', countryCodec)
  .field('type', unitType)
  .field('territory', provinceCodec)
  .optionalField('coast', (_context, unit) =>
    unit.type === UnitKind.Fleet ? coastCodec : literal<string | undefined, FieldContext>(undefined),
  )

/** An army omits the coast property; fleets include it only when specified. */
export const unitCodec: Codec<Unit, FieldContext> = {
  decode(reader, context) {
    return unitFields.decode(reader, context)
  },
  encode(writer, unit, context) {
    unitFields.encode(writer, { ...unit, coast: unit.type === UnitKind.Fleet ? unit.coast : undefined }, context)
  },
}

/** A dislodged unit and the province its attacker came from. */
export const dislodgedCodec: Codec<BoardState['dislodged'][number], FieldContext> = {
  encode(writer, entry, context) {
    unitCodec.encode(writer, entry.unit, context)
    optionalPlace.encode(writer, entry.attackedFrom, context)
  },
  decode(reader, context) {
    const unit = unitCodec.decode(reader, context)
    const attackedFrom = optionalPlace.decode(reader, context) ?? EMPTY_TEXT
    return { unit, attackedFrom }
  },
}
