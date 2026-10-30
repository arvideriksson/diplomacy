/** Minimal, symmetric bit codecs. No browser, Svelte, database or Node imports. */
export interface Codec<T, C = void> {
  read(reader: Pick<BitReader, 'uint'>, context: C): T
  write(writer: Pick<BitWriter, 'uint'>, value: T, context: C): void
}
export class BitWriter {
  private data: number[] = []
  bitLength = 0
  uint(value: number, width: number): void {
    if (
      !Number.isInteger(width) ||
      width < 0 ||
      width > 32 ||
      !Number.isInteger(value) ||
      value < 0 ||
      value >= 2 ** width
    )
      throw Error('Invalid unsigned bit field')
    for (let i = width - 1; i >= 0; i--) {
      const byte = this.bitLength >>> 3
      this.data[byte] = (this.data[byte] ?? 0) | ((Math.floor(value / 2 ** i) % 2) << (7 - (this.bitLength % 8)))
      this.bitLength++
    }
  }
  bytes(): Uint8Array {
    return Uint8Array.from(this.data)
  }
}
export class BitReader {
  position = 0
  constructor(readonly bytes: Uint8Array) {}
  uint(width: number): number {
    if (!Number.isInteger(width) || width < 0 || width > 32 || this.position + width > this.bytes.length * 8)
      throw Error('Truncated bit field')
    let result = 0
    for (let i = 0; i < width; i++) {
      result = result * 2 + ((this.bytes[this.position >>> 3] >>> (7 - (this.position % 8))) & 1)
      this.position++
    }
    return result
  }
  finish(): void {
    if (this.bytes.length * 8 - this.position >= 8) throw Error('Trailing bytes')
    while (this.position < this.bytes.length * 8) if (this.uint(1)) throw Error('Nonzero padding')
  }
}
export const flag: Codec<boolean, unknown> = {
  read: (r) => Boolean(r.uint(1)),
  write(w, value) {
    if (typeof value !== 'boolean') throw Error('Expected boolean')
    w.uint(Number(value), 1)
  },
}
export function literal<T, C = unknown>(expected: T): Codec<T, C> {
  return {
    read: () => expected,
    write(_w, value) {
      if (value !== expected) throw Error('Literal mismatch')
    },
  }
}
/** Truncated binary: optimal prefix lengths for a uniformly likely bounded choice. */
export function choice<T, C = unknown>(values: readonly T[]): Codec<T, C> {
  if (!values.length || new Set(values).size !== values.length) throw Error('Expected distinct choices')
  const width = Math.floor(Math.log2(values.length)),
    cutoff = 2 ** (width + 1) - values.length
  return {
    read(r) {
      const head = r.uint(width),
        index = head < cutoff ? head : head * 2 + r.uint(1) - cutoff
      if (index >= values.length) throw Error('Invalid choice')
      return values[index]
    },
    write(w, value) {
      const index = values.indexOf(value)
      if (index < 0) throw Error('Value outside dictionary')
      if (index < cutoff) w.uint(index, width)
      else w.uint(index + cutoff, width + 1)
    },
  }
}
type RecordValue = Record<string, unknown>
type Field<C> = { name: string; resolve(context: C, previous: RecordValue): Codec<unknown, C> }
/** Each added field sees the types of fields declared before it, in both directions. */
export class Struct<T extends object, C> implements Codec<T, C> {
  constructor(private readonly fields: readonly Field<C>[] = []) {}
  field<K extends string, V>(
    name: K extends keyof T ? never : K,
    codec: Codec<V, C> | ((context: C, previous: T) => Codec<V, C>),
  ): Struct<T & Record<K, V>, C> {
    const resolve = typeof codec === 'function' ? codec : () => codec
    // The only type erasure is internal: the builder's generic tracks the same field order.
    return new Struct([...this.fields, { name, resolve: resolve as Field<C>['resolve'] }])
  }
  read(r: BitReader, context: C): T {
    const previous: RecordValue = {}
    for (const field of this.fields) previous[field.name] = field.resolve(context, previous).read(r, context)
    return previous as T
  }
  write(w: BitWriter, value: T, context: C): void {
    const previous: RecordValue = {},
      record = value as RecordValue
    for (const field of this.fields) {
      field.resolve(context, previous).write(w, record[field.name], context)
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
  const reader = new BitReader(bytes),
    value = codec.read(reader, context)
  reader.finish()
  return value
}
