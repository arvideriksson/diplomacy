/** Values that have a fixed meaning in the version 1 wire format. */
export enum WireBit {
  Zero = 0,
  One = 1,
}

export enum WireSize {
  Byte = 8,
  Checksum = 32,
  Power = 3,
  Phase = 2,
  Mode = 2,
  Movement = 2,
  UnitType = 2,
  Header = 1,
  Trailer = 4,
  Minimum = 6,
}

export enum WireLimit {
  PayloadBytes = 32768,
  PayloadChars = 44000,
  Frames = 1024,
  Orders = 256,
  ListItems = 256,
  StringChars = 1024,
  Integer = 65535,
  GammaPrefix = 30,
}

export enum WireHeader {
  Raw = 0x10,
  Deflate = 0x11,
}

export enum MapKind {
  Classical = 'classical',
  Variant1900 = '1900',
}

export enum PhaseKind {
  Movement = 'movement',
  Retreat = 'retreat',
  Build = 'build',
}

export enum SeasonKind {
  Spring = 'Spring',
  Fall = 'Fall',
}

export enum UnitKind {
  Army = 'army',
  Fleet = 'fleet',
}

export enum OrderKind {
  Hold = 'Hold',
  Move = 'Move',
  Support = 'Support',
  Convoy = 'Convoy',
  Retreat = 'Retreat',
  Disband = 'Disband',
  Build = 'Build',
  Remove = 'Remove',
}

export enum CoastKind {
  North = 'nc',
  South = 'sc',
  East = 'ec',
  West = 'wc',
}

export enum PowerKind {
  England = 'england',
  Britain = 'britain',
  France = 'france',
  Italy = 'italy',
  Germany = 'germany',
  Austria = 'austria',
  Turkey = 'turkey',
  Russia = 'russia',
  Neutral = 'neutral',
}

export enum OwnerMode {
  Opening = 0,
  Changes = 1,
  Complete = 2,
  Reserved = 3,
}

export enum WireError {
  Invalid = 'Invalid sandbox payload',
  Truncated = 'Truncated sandbox payload',
  TooLarge = 'Sandbox payload is too large',
}

export const RULES_ID = 0x0a9bca37
export const CRC_SEED = 0xffffffff
export const CRC_POLYNOMIAL = 0xedb88320
export const POWER_IDS = [
  PowerKind.England,
  PowerKind.France,
  PowerKind.Italy,
  PowerKind.Germany,
  PowerKind.Austria,
  PowerKind.Turkey,
  PowerKind.Russia,
] as const
export const COAST_IDS = [undefined, CoastKind.North, CoastKind.South, CoastKind.East] as const
export const PHASE_IDS = [PhaseKind.Movement, PhaseKind.Retreat, PhaseKind.Build] as const

/** Reject malformed input before it reaches the game engine or local storage. */
export function requireWire(condition: unknown, message: string = WireError.Invalid): asserts condition {
  if (!condition) throw new Error(message)
}

export function requireEqual(actual: unknown, expected: unknown): void {
  const matches = actual === expected
  requireWire(matches)
}

export function bounded(value: number, maximum: number): number {
  const integer = Number.isInteger(value)
  const inRange = value >= WireBit.Zero && value <= maximum
  requireWire(integer && inRange)
  return value
}

/** A readable bit stream shared by the version 1 encoder and decoder. */
export class WireStream {
  readonly data: number[] = []
  pos = WireBit.Zero

  constructor(bytes?: Uint8Array) {
    if (bytes) this.load(bytes)
  }

  uint(width: number): number
  uint(value: number, width: number): void
  uint(value: number, width?: number): number | void {
    if (width === undefined) return this.get(value)
    this.put(value, width)
  }

  private load(bytes: Uint8Array): void {
    for (const byte of bytes) this.loadByte(byte)
  }

  private loadByte(byte: number): void {
    for (let shift = WireSize.Byte - WireBit.One; shift >= WireBit.Zero; shift--) {
      const bit = (byte >>> shift) & WireBit.One
      this.data.push(bit)
    }
  }

  put(value: number, width: number): void {
    const valid = Number.isInteger(value) && value >= WireBit.Zero && value < WireMath.Radix ** width
    requireWire(valid)
    this.writeBits(value, width)
  }

  private writeBits(value: number, width: number): void {
    for (let shift = width - WireBit.One; shift >= WireBit.Zero; shift--) {
      const bit = Math.floor(value / WireMath.Radix ** shift) % WireMath.Radix
      this.data.push(bit)
    }
  }

  get(width: number): number {
    const end = this.pos + width
    requireWire(end <= this.data.length, WireError.Truncated)
    return this.readBits(width)
  }

  private readBits(width: number): number {
    let value = WireBit.Zero
    for (let index = WireBit.Zero; index < width; index++) {
      value *= WireMath.Radix
      value += this.data[this.pos]
      this.pos++
    }
    return value
  }

  integer(): number
  integer(value: number): void
  integer(value?: number): number | void {
    if (value === undefined) return this.readInteger()
    this.writeInteger(value)
  }

  private writeInteger(value: number): void {
    const next = value + WireBit.One
    const binary = next.toString(WireMath.Radix)
    const prefix = binary.length - WireBit.One
    this.put(WireBit.Zero, prefix)
    this.put(next, binary.length)
  }

  private readInteger(): number {
    let prefix = WireBit.Zero
    while (this.get(WireBit.One) === WireBit.Zero) {
      prefix++
      requireWire(prefix < WireLimit.GammaPrefix)
    }
    const value = WireMath.Radix ** prefix + this.get(prefix) - WireBit.One
    return bounded(value, WireLimit.Integer)
  }

  text(): string
  text(value: string): void
  text(value?: string): string | void {
    if (value === undefined) return this.readString()
    this.writeString(value)
  }

  private writeString(value: string): void {
    const bytes = new TextEncoder().encode(value)
    this.integer(bytes.length)
    for (const byte of bytes) this.put(byte, WireSize.Byte)
  }

  private readString(): string {
    const count = this.integer()
    const bytes = Array.from({ length: count }, () => this.get(WireSize.Byte))
    const data = Uint8Array.from(bytes)
    return new TextDecoder('utf-8', { fatal: true }).decode(data)
  }

  bytes(): Uint8Array {
    const length = Math.ceil(this.data.length / WireSize.Byte)
    const bytes = new Uint8Array(length)
    this.data.forEach((bit, index) => this.saveBit(bytes, bit, index))
    return bytes
  }

  private saveBit(bytes: Uint8Array, bit: number, index: number): void {
    const byte = index >> WireMath.ByteShift
    const shift = WireSize.Byte - WireBit.One - (index % WireSize.Byte)
    bytes[byte] |= bit << shift
  }
}

/** CRC-32/IEEE used for transport and final-board verification. */
export class WireChecksum {
  static calculate(bytes: Uint8Array): number {
    let value = CRC_SEED
    for (const byte of bytes) value = WireChecksum.foldByte(value, byte)
    return (value ^ CRC_SEED) >>> WireBit.Zero
  }

  private static foldByte(value: number, byte: number): number {
    let result = value ^ byte
    for (let bit = WireBit.Zero; bit < WireSize.Byte; bit++) {
      const mask = result & WireBit.One ? CRC_POLYNOMIAL : WireBit.Zero
      result = (result >>> WireBit.One) ^ mask
    }
    return result
  }
}

export enum MovementCode {
  Move = 0,
  Support = 2,
  Hold = 6,
  Convoy = 7,
}

export enum MovementWidth {
  Move = 1,
  Support = 2,
  Hold = 3,
  Convoy = 3,
}

export const AUX_ACTIONS: readonly string[] = [OrderKind.Support, OrderKind.Convoy]
export const TARGET_ACTIONS: readonly string[] = [
  OrderKind.Support,
  OrderKind.Convoy,
  OrderKind.Move,
  OrderKind.Retreat,
]
export const COAST_ACTIONS: readonly string[] = [OrderKind.Move, OrderKind.Retreat]
export const BUILD_TYPES: ReadonlyArray<'army' | 'fleet' | undefined> = [undefined, UnitKind.Army, UnitKind.Fleet]

export enum CompressionMode {
  Compress = 'compress',
  Decompress = 'decompress',
}

export enum Base64Char {
  Plus = '+',
  Slash = '/',
  Minus = '-',
  Underline = '_',
  Empty = '',
}

export const DEFLATE_FORMAT = 'deflate-raw'
export const PAYLOAD_PATTERN = /^[A-Za-z0-9_-]+$/

export enum PowerCode {
  Neutral = 7,
}

export enum WireIndex {
  Missing = -1,
}

export const EMPTY_TEXT = ''

export enum WireMath {
  Radix = 2,
  ByteShift = 3,
}
