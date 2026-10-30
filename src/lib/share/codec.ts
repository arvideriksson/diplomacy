import { adjudicate, initialBoard } from '../adjudicator'
import { sortUnits } from '../adjudicator/state'
import { maps } from '../maps'
import { OrderCodec } from './order-modes'
import { countryCodec, provinceCodec, optionalPlace, unitCodec } from './fields'
import type { MapDefinition } from '../mapDefinition'
import type { Unit } from '../types'
import type { BoardState, Phase } from '../adjudicator'
import type { ShareTimeline, TimelineEntry } from './timeline'
import { CanonicalValue } from './canonical'

import {
  bounded,
  shortest,
  EMPTY_TEXT,
  WireIndex,
  PHASE_IDS,
  RULES_ID,
  requireEqual as assertEqual,
  requireWire as assert,
  WireChecksum,
  WireStream as Bits,
  MapKind,
  OwnerMode,
  PowerKind,
  SeasonKind,
  WireBit,
  WireError,
  WireHeader as PayloadKind,
  WireLimit,
  WireSize,
} from './wire'

const phases: readonly Phase[] = PHASE_IDS
const crc32 = WireChecksum.calculate

const equal = CanonicalValue.equal.bind(CanonicalValue)
export class BoardCodec {
  map: MapDefinition
  provinces: string[]
  centers: string[]
  provinceBits: number
  centerBits: number
  opening: BoardState
  constructor(map: MapDefinition) {
    this.map = map
    this.provinces = Object.keys(map.territories).sort()
    this.centers = this.provinces.filter((province) => map.territories[province].supplyCenter)
    this.provinceBits = Math.ceil(Math.log2(this.provinces.length))
    this.centerBits = Math.ceil(Math.log2(this.centers.length))
    this.opening = initialBoard(map)
  }
  private writeUnitList(stream: Bits, units: Unit[], force: boolean): void {
    const ordered = sortUnits(units)
    const complete = this.completeUnits(ordered)
    const changes = this.changedUnits(ordered)
    const selected = shortest(complete, force ? undefined : changes)
    stream.data.push(...selected.data)
  }

  private completeUnits(units: Unit[]): Bits {
    const stream = new Bits()
    stream.put(WireBit.Zero, WireBit.One)
    stream.writeInteger(units.length)
    for (const unit of units) unitCodec.encode(stream, unit, this)
    return stream
  }

  private changedUnits(units: Unit[]): Bits {
    const stream = new Bits()
    const removed = this.removedUnits(units)
    const added = units.filter((unit) => !this.opening.units.some((start) => equal(start, unit)))
    stream.put(WireBit.One, WireBit.One)
    stream.writeInteger(removed.length)
    this.writeUnitIndexes(stream, removed)
    stream.writeInteger(added.length)
    for (const unit of added) unitCodec.encode(stream, unit, this)
    return stream
  }

  private removedUnits(units: Unit[]): number[] {
    return this.opening.units
      .map((unit, index) => (units.some((item) => equal(unit, item)) ? WireIndex.Missing : index))
      .filter((index) => index >= WireBit.Zero)
  }

  private writeUnitIndexes(stream: Bits, indexes: number[]): void {
    const width = Math.ceil(Math.log2(this.opening.units.length))
    for (const index of indexes) stream.put(index, width)
  }

  private readUnitList(stream: Bits): Unit[] {
    if (stream.get(WireBit.One)) return this.readChangedUnits(stream)
    return this.readUnits(stream)
  }

  private readUnits(stream: Bits): Unit[] {
    const count = bounded(stream.readInteger(), WireLimit.ListItems)
    return Array.from({ length: count }, () => unitCodec.decode(stream, this))
  }

  private readChangedUnits(stream: Bits): Unit[] {
    const count = bounded(stream.readInteger(), WireLimit.ListItems)
    const width = Math.ceil(Math.log2(this.opening.units.length))
    const removed = Array.from({ length: count }, () => stream.get(width))
    const remaining = this.opening.units.filter((_unit, index) => !removed.includes(index))
    const added = this.readUnits(stream)
    return sortUnits([...remaining, ...added])
  }

  private writeOwners(stream: Bits, owners: Record<string, string>, force: boolean): void {
    const complete = this.completeOwners(owners)
    const changes = this.changedOwners(owners)
    const selected = shortest(complete, force ? undefined : changes)
    stream.data.push(...selected.data)
  }

  private completeOwners(owners: Record<string, string>): Bits {
    const stream = new Bits()
    stream.put(OwnerMode.Complete, WireSize.Mode)
    for (const center of this.centers) countryCodec.encode(stream, owners[center] ?? PowerKind.Neutral, this)
    return stream
  }

  private changedOwners(owners: Record<string, string>): Bits {
    const stream = new Bits()
    const changes = this.centers.filter((center) => owners[center] !== this.opening.supplyCenters[center])
    stream.put(changes.length ? OwnerMode.Changes : OwnerMode.Opening, WireSize.Mode)
    if (!changes.length) return stream
    stream.writeInteger(changes.length)
    for (const center of changes) this.writeOwnerChange(stream, center, owners)
    return stream
  }

  private writeOwnerChange(stream: Bits, center: string, owners: Record<string, string>): void {
    const index = this.centers.indexOf(center)
    const owner = owners[center] ?? PowerKind.Neutral
    stream.put(index, this.centerBits)
    countryCodec.encode(stream, owner, this)
  }

  private readOwners(stream: Bits): Record<string, string> {
    const mode = stream.get(WireSize.Mode)
    assert(mode !== OwnerMode.Reserved)
    const owners = mode === OwnerMode.Complete ? {} : { ...this.opening.supplyCenters }
    if (mode === OwnerMode.Complete) this.readCompleteOwners(stream, owners)
    if (mode === OwnerMode.Changes) this.readChangedOwners(stream, owners)
    return owners
  }

  private readCompleteOwners(stream: Bits, owners: Record<string, string>): void {
    for (const center of this.centers) {
      const owner = countryCodec.decode(stream, this)
      if (owner !== PowerKind.Neutral) owners[center] = owner
    }
  }

  private readChangedOwners(stream: Bits, owners: Record<string, string>): void {
    const count = stream.readInteger()
    for (let index = WireBit.Zero; index < count; index++) this.readOwnerChange(stream, owners)
  }

  private readOwnerChange(stream: Bits, owners: Record<string, string>): void {
    const center = this.centers[stream.get(this.centerBits)]
    const owner = countryCodec.decode(stream, this)
    assert(center)
    if (owner === PowerKind.Neutral) delete owners[center]
    else owners[center] = owner
  }

  encode(stream: Bits, board: BoardState, force = false): void {
    const opening = !force && equal(board, this.opening)
    stream.put(opening ? WireBit.One : WireBit.Zero, WireBit.One)
    if (opening) return
    stream.writeInteger(board.year)
    stream.put(board.season === SeasonKind.Fall ? WireBit.One : WireBit.Zero, WireBit.One)
    stream.put(phases.indexOf(board.phase), WireSize.Phase)
    this.writeUnitList(stream, board.units, force)
    this.writeOwners(stream, board.supplyCenters, force)
    this.writeDislodged(stream, board.dislodged)
    this.writeContested(stream, board.contested)
  }

  private writeDislodged(stream: Bits, units: BoardState['dislodged']): void {
    stream.writeInteger(units.length)
    for (const entry of units) {
      unitCodec.encode(stream, entry.unit, this)
      optionalPlace.encode(stream, entry.attackedFrom, this)
    }
  }

  private writeContested(stream: Bits, regions: string[]): void {
    stream.writeInteger(regions.length)
    for (const region of [...regions].sort()) provinceCodec.encode(stream, region, this)
  }

  decode(stream: Bits): BoardState {
    if (stream.get(WireBit.One)) return structuredClone(this.opening)
    const year = stream.readInteger()
    const season = stream.get(WireBit.One) ? SeasonKind.Fall : SeasonKind.Spring
    const phase = phases[stream.get(WireSize.Mode)]
    assert(phase)
    const units = this.readUnitList(stream)
    const supplyCenters = this.readOwners(stream)
    const dislodged = this.readDislodged(stream)
    const contested = this.readContested(stream)
    return { mapId: this.map.id, year, season, phase, units, supplyCenters, dislodged, contested }
  }

  private readDislodged(stream: Bits): BoardState['dislodged'] {
    const count = bounded(stream.readInteger(), WireLimit.ListItems)
    return Array.from({ length: count }, () => this.readDislodgedUnit(stream))
  }

  private readDislodgedUnit(stream: Bits): BoardState['dislodged'][number] {
    const unit = unitCodec.decode(stream, this)
    const attackedFrom = optionalPlace.decode(stream, this) ?? EMPTY_TEXT
    return { unit, attackedFrom }
  }

  private readContested(stream: Bits): string[] {
    const count = bounded(stream.readInteger(), WireLimit.ListItems)
    return Array.from({ length: count }, () => provinceCodec.decode(stream, this))
  }

  boardChecksum(board: BoardState): number {
    const stream = new Bits()
    this.encode(stream, board, true)
    return crc32(stream.bytes())
  }
}

/** Envelope used by the raw version 1 encoder and decoder. */
class WireEnvelope {
  static encode(raw: Uint8Array): Uint8Array {
    if (raw.length > WireLimit.PayloadBytes) throw new Error(WireError.TooLarge)
    const envelope = new Uint8Array(raw.length + WireSize.Header + WireSize.Trailer)
    envelope[WireBit.Zero] = PayloadKind.Raw
    envelope.set(raw, WireSize.Header)
    const checksum = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength)
    checksum.setUint32(envelope.length - WireSize.Trailer, crc32(raw))
    return envelope
  }

  static decode(envelope: Uint8Array): Uint8Array {
    assert(
      envelope.length >= WireSize.Minimum &&
        envelope.length <= WireLimit.PayloadBytes + WireSize.Header + WireSize.Trailer &&
        envelope[WireBit.Zero] === PayloadKind.Raw,
    )
    const raw = envelope.subarray(WireSize.Header, -WireSize.Trailer)
    const checksum = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength)
    assertEqual(crc32(raw), checksum.getUint32(envelope.length - WireSize.Trailer))
    return raw
  }
}

interface FrameHeader {
  mapId: string
  name: string
  count: number
  cursor: number
}

/** Map and timeline metadata, before the first board. */
class MetadataCodec {
  encode(stream: Bits, timeline: ShareTimeline): void {
    const mapCode = timeline.mapId === MapKind.Variant1900 ? WireBit.One : WireBit.Zero
    stream.put(mapCode, WireBit.One)
    stream.put(RULES_ID, WireSize.Checksum)
    stream.writeString(timeline.name)
    stream.writeInteger(timeline.entries.length)
    stream.writeInteger(timeline.cursor)
  }

  decode(stream: Bits): FrameHeader {
    const mapId = stream.get(WireBit.One) ? MapKind.Variant1900 : MapKind.Classical
    assertEqual(stream.get(WireSize.Checksum), RULES_ID)
    const name = stream.readString()
    const count = stream.readInteger()
    const cursor = stream.readInteger()
    assert(count > WireBit.Zero && count <= WireLimit.Frames && cursor < count && name.length <= WireLimit.StringChars)
    return { mapId, name, count, cursor }
  }
}

/** A frame delegates orders and optional board checkpoints to their codecs. */
class FrameCodec {
  constructor(private readonly format: OrderCodec) {}

  encode(stream: Bits, entry: TimelineEntry, hasNext: boolean): void {
    assert(entry.orders.length <= WireLimit.Orders)
    this.format.encode(stream, entry.board, entry.orders)
    stream.put(entry.showResults ? WireBit.One : WireBit.Zero, WireBit.One)
    if (!hasNext) return
    stream.put(entry.checkpoint ? WireBit.One : WireBit.Zero, WireBit.One)
    if (entry.checkpoint) this.format.boards.encode(stream, entry.checkpoint)
  }

  decode(stream: Bits, board: BoardState, hasNext: boolean): { entry: TimelineEntry; next?: BoardState } {
    const orders = this.format.decode(stream, board)
    assert(orders.length <= WireLimit.Orders)
    const showResults = Boolean(stream.get(WireBit.One))
    const result = showResults || hasNext ? adjudicate(this.format.map, board, orders) : undefined
    const checkpoint = hasNext && stream.get(WireBit.One) ? this.format.boards.decode(stream) : undefined
    const next = checkpoint ?? (hasNext ? result?.newBoardState : undefined)
    const entry = { board, orders, showResults, ...(checkpoint ? { checkpoint } : {}) }
    return { entry, next }
  }
}

/** Encode a prepared timeline to a checksummed versioned envelope. */
function encodeSandbox(timeline: ShareTimeline): Uint8Array {
  const { mapId, cursor, entries, initialBoard } = timeline
  assert(mapId === MapKind.Classical || mapId === MapKind.Variant1900)
  assert(
    entries.length > WireBit.Zero &&
      entries.length <= WireLimit.Frames &&
      cursor >= WireBit.Zero &&
      cursor < entries.length,
  )
  const stream = new Bits()
  const format = new OrderCodec(new BoardCodec(maps[mapId]))
  const frames = new FrameCodec(format)
  new MetadataCodec().encode(stream, timeline)
  format.boards.encode(stream, initialBoard)
  for (const [index, entry] of entries.entries()) {
    frames.encode(stream, entry, index + WireBit.One < entries.length)
  }
  const last = entries.at(WireIndex.Missing)
  assert(last)
  stream.put(format.boards.boardChecksum(last.board), WireSize.Checksum)
  return WireEnvelope.encode(stream.bytes())
}

/** Decode metadata and each phase while replaying boards for order context. */
function decodeSandbox(envelope: Uint8Array): ShareTimeline {
  const stream = new Bits(WireEnvelope.decode(envelope))
  const { name, mapId, count, cursor } = new MetadataCodec().decode(stream)
  const format = new OrderCodec(new BoardCodec(maps[mapId]))
  const frames = new FrameCodec(format)
  const initialBoard = format.boards.decode(stream)
  const entries: TimelineEntry[] = []
  let board = initialBoard
  for (let index = WireBit.Zero; index < count; index++) {
    const result = frames.decode(stream, board, index + WireBit.One < count)
    entries.push(result.entry)
    if (result.next) board = result.next
  }
  assertEqual(format.boards.boardChecksum(board), stream.get(WireSize.Checksum))
  assert(stream.data.length - stream.pos < WireSize.Byte)
  while (stream.pos < stream.data.length) assertEqual(stream.get(WireBit.One), WireBit.Zero)
  return { name, mapId, initialBoard, entries, cursor }
}

export { decodeSandbox, encodeSandbox, equal }
