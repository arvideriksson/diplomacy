import { WireBit, WireMath, WireSize, WireStream } from './wire'

const INVALID_FIELD = 'Invalid unsigned bit field'
const TRUNCATED_BITS = 'Truncated bit field'
const TRAILING_BYTES = 'Trailing bytes'
const NONZERO_PADDING = 'Nonzero padding'
const BAD_CHOICES = 'Expected distinct choices'
const INVALID_CHOICE = 'Invalid choice'
const MISSING_CHOICE = 'Value outside dictionary'
const EXPECTED_FLAG = 'Expected boolean'
const LITERAL_ERROR = 'Literal mismatch'

/** A field codec reads and writes the same representation. */
export interface Codec<T, C = void> {
  decode(reader: Pick<BitReader, 'get'>, context: C): T
  encode(writer: Pick<BitWriter, 'put'>, value: T, context: C): void
}

/** Maps a value to a fixed-width integer, optionally using the current context. */
export function fixedBits<T, C>(spec: {
  size: number | ((context: C) => number)
  encode: (value: T, context: C) => number
  decode: (value: number, context: C) => T
}): Codec<T, C> {
  const width = (context: C) => {
    const size = typeof spec.size === 'number' ? spec.size : spec.size(context)
    if (!Number.isInteger(size) || size < WireBit.Zero || size > WireSize.Checksum) throw Error(INVALID_FIELD)
    return size
  }
  return {
    decode: (reader, context) => spec.decode(reader.get(width(context)), context),
    encode: (writer, value, context) => writer.put(spec.encode(value, context), width(context)),
  }
}

/** A bounded writer backed by the same bitstream used by the sandbox format. */
export class BitWriter {
  private readonly stream = new WireStream()

  get bitLength(): number {
    return this.stream.data.length
  }

  put(value: number, width: number): void {
    if (!Number.isInteger(width) || width < WireBit.Zero || width > WireSize.Checksum) throw Error(INVALID_FIELD)
    if (!Number.isInteger(value) || value < WireBit.Zero || value >= WireMath.Radix ** width) throw Error(INVALID_FIELD)
    this.stream.put(value, width)
  }

  bytes(): Uint8Array {
    return this.stream.bytes()
  }
}

/** A bounded reader backed by the same bitstream used by the sandbox format. */
export class BitReader {
  private readonly stream: WireStream

  constructor(bytes: Uint8Array) {
    this.stream = new WireStream(bytes)
  }

  get(width: number): number {
    if (!Number.isInteger(width) || width < WireBit.Zero || width > WireSize.Checksum) throw Error(TRUNCATED_BITS)
    if (this.stream.pos + width > this.stream.data.length) throw Error(TRUNCATED_BITS)
    return this.stream.get(width)
  }

  finish(): void {
    if (this.stream.data.length - this.stream.pos >= WireSize.Byte) throw Error(TRAILING_BYTES)
    while (this.stream.pos < this.stream.data.length) {
      if (this.get(WireBit.One)) throw Error(NONZERO_PADDING)
    }
  }
}

/** A single-bit Boolean field. */
export class FlagCodec implements Codec<boolean, unknown> {
  decode(reader: Pick<BitReader, 'get'>): boolean {
    return Boolean(reader.get(WireBit.One))
  }

  encode(writer: Pick<BitWriter, 'put'>, value: boolean): void {
    if (typeof value !== 'boolean') throw Error(EXPECTED_FLAG)
    writer.put(Number(value), WireBit.One)
  }
}

/** A field whose value is known from context and needs no bits. */
export class LiteralCodec<T, C = unknown> implements Codec<T, C> {
  constructor(private readonly expected: T) {}

  decode(): T {
    return this.expected
  }

  encode(_writer: Pick<BitWriter, 'put'>, value: T): void {
    if (value !== this.expected) throw Error(LITERAL_ERROR)
  }
}

export const flag = new FlagCodec()

export function literal<T, C = unknown>(expected: T): Codec<T, C> {
  return new LiteralCodec(expected)
}

/** Truncated binary uses short codes for the first values in a dictionary. */
export class ChoiceCodec<T, C = unknown> implements Codec<T, C> {
  private readonly width: number
  private readonly cutoff: number

  constructor(private readonly values: readonly T[]) {
    if (!values.length || new Set(values).size !== values.length) throw Error(BAD_CHOICES)
    this.width = Math.floor(Math.log2(values.length))
    const length = this.width + WireBit.One
    this.cutoff = WireMath.Radix ** length - values.length
  }

  decode(reader: Pick<BitReader, 'get'>): T {
    const index = this.readIndex(reader)
    if (index >= this.values.length) throw Error(INVALID_CHOICE)
    return this.values[index]
  }

  private readIndex(reader: Pick<BitReader, 'get'>): number {
    const head = reader.get(this.width)
    if (head < this.cutoff) return head
    const suffix = reader.get(WireBit.One)
    const extended = head * WireMath.Radix + suffix
    return extended - this.cutoff
  }

  encode(writer: Pick<BitWriter, 'put'>, value: T): void {
    const index = this.values.indexOf(value)
    if (index < WireBit.Zero) throw Error(MISSING_CHOICE)
    if (index < this.cutoff) {
      writer.put(index, this.width)
      return
    }
    const extended = index + this.cutoff
    const width = this.width + WireBit.One
    writer.put(extended, width)
  }
}

export function choice<T, C = unknown>(values: readonly T[]): Codec<T, C> {
  return new ChoiceCodec(values)
}

/** The order codecs use sorted, distinct candidate dictionaries. */
export function sortedChoices(values: string[]): Codec<string, unknown> {
  return choice([...new Set(values)].sort())
}

type RecordValue = Record<string, unknown>
type Field<C> = { name: string; resolve(context: C, previous: RecordValue): Codec<unknown, C> }

/** Each field sees the typed values of the fields declared before it. */
export class Struct<T extends object, C> implements Codec<T, C> {
  constructor(private readonly fields: readonly Field<C>[] = []) {}

  field<K extends string, V>(
    name: K extends keyof T ? never : K,
    codec: Codec<V, C> | ((context: C, previous: T) => Codec<V, C>),
  ): Struct<T & Record<K, V>, C> {
    const resolve = typeof codec === 'function' ? codec : () => codec
    const field = { name, resolve: resolve as Field<C>['resolve'] }
    return new Struct([...this.fields, field])
  }

  decode(reader: Pick<BitReader, 'get'>, context: C): T {
    const previous: RecordValue = {}
    for (const field of this.fields) {
      const codec = field.resolve(context, previous)
      previous[field.name] = codec.decode(reader, context)
    }
    return previous as T
  }

  encode(writer: Pick<BitWriter, 'put'>, value: T, context: C): void {
    const previous: RecordValue = {}
    const record = value as RecordValue
    for (const field of this.fields) {
      const codec = field.resolve(context, previous)
      codec.encode(writer, record[field.name], context)
      previous[field.name] = record[field.name]
    }
  }
}

export const struct = <C>() => new Struct<Record<never, never>, C>()

export function encode<T, C>(codec: Codec<T, C>, value: T, context: C): { bytes: Uint8Array; bitLength: number } {
  const writer = new BitWriter()
  codec.encode(writer, value, context)
  return { bytes: writer.bytes(), bitLength: writer.bitLength }
}

export function decode<T, C>(codec: Codec<T, C>, bytes: Uint8Array, context: C): T {
  const reader = new BitReader(bytes)
  const value = codec.decode(reader, context)
  reader.finish()
  return value
}
