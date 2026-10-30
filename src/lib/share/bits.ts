import { WireBit, WireMath, WireSize } from './wire'

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
  read(reader: Pick<BitReader, 'uint'>, context: C): T
  write(writer: Pick<BitWriter, 'uint'>, value: T, context: C): void
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
    read: (reader, context) => spec.decode(reader.uint(width(context)), context),
    write: (writer, value, context) => writer.uint(spec.encode(value, context), width(context)),
  }
}

/** Writes bounded unsigned values to a bit-packed buffer. */
export class BitWriter {
  private data: number[] = []
  bitLength = WireBit.Zero

  uint(value: number, width: number): void {
    this.checkField(value, width)
    for (let index = width - WireBit.One; index >= WireBit.Zero; index--) {
      this.writeBit(value, index)
    }
  }

  private checkField(value: number, width: number): void {
    if (!Number.isInteger(width) || width < WireBit.Zero || width > WireSize.Checksum) throw Error(INVALID_FIELD)
    if (!Number.isInteger(value) || value < WireBit.Zero) throw Error(INVALID_FIELD)
    if (value >= WireMath.Radix ** width) throw Error(INVALID_FIELD)
  }

  private writeBit(value: number, index: number): void {
    const byte = this.bitLength >>> WireMath.ByteShift
    const power = WireMath.Radix ** index
    const shifted = Math.floor(value / power)
    const bit = shifted % WireMath.Radix
    const position = WireMath.LastBit - (this.bitLength % WireSize.Byte)
    this.data[byte] = (this.data[byte] ?? WireBit.Zero) | (bit << position)
    this.bitLength++
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.data)
  }
}

/** Reads bounded unsigned values from a bit-packed buffer. */
export class BitReader {
  position = WireBit.Zero

  constructor(readonly bytes: Uint8Array) {}

  uint(width: number): number {
    this.checkWidth(width)
    let result = WireBit.Zero
    for (let index = WireBit.Zero; index < width; index++) {
      result *= WireMath.Radix
      result += this.readBit()
    }
    return result
  }

  private checkWidth(width: number): void {
    if (!Number.isInteger(width) || width < WireBit.Zero || width > WireSize.Checksum) throw Error(TRUNCATED_BITS)
    const end = this.position + width
    const limit = this.bytes.length * WireSize.Byte
    if (end > limit) throw Error(TRUNCATED_BITS)
  }

  private readBit(): number {
    const byte = this.position >>> WireMath.ByteShift
    const offset = this.position % WireSize.Byte
    const shift = WireMath.LastBit - offset
    const value = (this.bytes[byte] >>> shift) & WireBit.One
    this.position++
    return value
  }

  finish(): void {
    const limit = this.bytes.length * WireSize.Byte
    if (limit - this.position >= WireSize.Byte) throw Error(TRAILING_BYTES)
    while (this.position < limit) {
      if (this.uint(WireBit.One)) throw Error(NONZERO_PADDING)
    }
  }
}

/** A single-bit Boolean field. */
export class FlagCodec implements Codec<boolean, unknown> {
  read(reader: Pick<BitReader, 'uint'>): boolean {
    return Boolean(reader.uint(WireBit.One))
  }

  write(writer: Pick<BitWriter, 'uint'>, value: boolean): void {
    if (typeof value !== 'boolean') throw Error(EXPECTED_FLAG)
    writer.uint(Number(value), WireBit.One)
  }
}

/** A field whose value is known from context and needs no bits. */
export class LiteralCodec<T, C = unknown> implements Codec<T, C> {
  constructor(private readonly expected: T) {}

  read(): T {
    return this.expected
  }

  write(_writer: Pick<BitWriter, 'uint'>, value: T): void {
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

  read(reader: Pick<BitReader, 'uint'>): T {
    const index = this.readIndex(reader)
    if (index >= this.values.length) throw Error(INVALID_CHOICE)
    return this.values[index]
  }

  private readIndex(reader: Pick<BitReader, 'uint'>): number {
    const head = reader.uint(this.width)
    if (head < this.cutoff) return head
    const suffix = reader.uint(WireBit.One)
    const extended = head * WireMath.Radix + suffix
    return extended - this.cutoff
  }

  write(writer: Pick<BitWriter, 'uint'>, value: T): void {
    const index = this.values.indexOf(value)
    if (index < WireBit.Zero) throw Error(MISSING_CHOICE)
    if (index < this.cutoff) {
      writer.uint(index, this.width)
      return
    }
    const extended = index + this.cutoff
    const width = this.width + WireBit.One
    writer.uint(extended, width)
  }
}

export function choice<T, C = unknown>(values: readonly T[]): Codec<T, C> {
  return new ChoiceCodec(values)
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

  read(reader: Pick<BitReader, 'uint'>, context: C): T {
    const previous: RecordValue = {}
    for (const field of this.fields) {
      const codec = field.resolve(context, previous)
      previous[field.name] = codec.read(reader, context)
    }
    return previous as T
  }

  write(writer: Pick<BitWriter, 'uint'>, value: T, context: C): void {
    const previous: RecordValue = {}
    const record = value as RecordValue
    for (const field of this.fields) {
      const codec = field.resolve(context, previous)
      codec.write(writer, record[field.name], context)
      previous[field.name] = record[field.name]
    }
  }
}

export const struct = <C>() => new Struct<Record<never, never>, C>()

export function encode<T, C>(codec: Codec<T, C>, value: T, context: C): { bytes: Uint8Array; bitLength: number } {
  const writer = new BitWriter()
  codec.write(writer, value, context)
  return { bytes: writer.bytes(), bitLength: writer.bitLength }
}

export function decode<T, C>(codec: Codec<T, C>, bytes: Uint8Array, context: C): T {
  const reader = new BitReader(bytes)
  const value = codec.read(reader, context)
  reader.finish()
  return value
}
