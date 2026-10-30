import { adjudicate, initialBoard } from '../adjudicator'
import { sortUnits } from '../adjudicator/state'
import { maps } from '../maps'
import { OrderCodec } from './order-modes'
import { countryCodec, provinceCodec, optionalPlace, unitCodec } from './fields'
import type { MapDefinition } from '../mapDefinition'
import type { Unit } from '../types'
import type { AdjudicationResult, AnyOrder, BoardState, Phase } from '../adjudicator'
import type { SandboxContent, ShareTimeline, TimelineEntry } from './timeline'
import type { Frame } from '../sandbox'
import { CanonicalValue } from './canonical'

import {
  bounded,
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
  unitList(stream: Bits): Unit[]
  unitList(stream: Bits, units: Unit[], force?: boolean): void
  unitList(stream: Bits, units?: Unit[], force = false): Unit[] | void {
    if (units) return this.writeUnitList(stream, units, force)
    return this.readUnitList(stream)
  }

  private writeUnitList(stream: Bits, units: Unit[], force: boolean): void {
    const ordered = sortUnits(units)
    const complete = this.completeUnits(ordered)
    const changes = this.changedUnits(ordered)
    const useChanges = !force && changes.data.length < complete.data.length
    const selected = useChanges ? changes : complete
    stream.data.push(...selected.data)
  }

  private completeUnits(units: Unit[]): Bits {
    const stream = new Bits()
    stream.put(WireBit.Zero, WireBit.One)
    stream.integer(units.length)
    for (const unit of units) unitCodec.write(stream, unit, this)
    return stream
  }

  private changedUnits(units: Unit[]): Bits {
    const stream = new Bits()
    const removed = this.removedUnits(units)
    const added = units.filter((unit) => !this.opening.units.some((start) => equal(start, unit)))
    stream.put(WireBit.One, WireBit.One)
    stream.integer(removed.length)
    this.writeUnitIndexes(stream, removed)
    stream.integer(added.length)
    for (const unit of added) unitCodec.write(stream, unit, this)
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
    const count = bounded(stream.integer(), WireLimit.ListItems)
    return Array.from({ length: count }, () => unitCodec.read(stream, this))
  }

  private readChangedUnits(stream: Bits): Unit[] {
    const count = bounded(stream.integer(), WireLimit.ListItems)
    const width = Math.ceil(Math.log2(this.opening.units.length))
    const removed = Array.from({ length: count }, () => stream.get(width))
    const remaining = this.opening.units.filter((_unit, index) => !removed.includes(index))
    const added = this.readUnits(stream)
    return sortUnits([...remaining, ...added])
  }

  owners(stream: Bits): Record<string, string>
  owners(stream: Bits, owners: Record<string, string>, force?: boolean): void
  owners(stream: Bits, owners?: Record<string, string>, force = false): Record<string, string> | void {
    if (owners) return this.writeOwners(stream, owners, force)
    return this.readOwners(stream)
  }

  private writeOwners(stream: Bits, owners: Record<string, string>, force: boolean): void {
    const complete = this.completeOwners(owners)
    const changes = this.changedOwners(owners)
    const useChanges = !force && changes.data.length < complete.data.length
    const selected = useChanges ? changes : complete
    stream.data.push(...selected.data)
  }

  private completeOwners(owners: Record<string, string>): Bits {
    const stream = new Bits()
    stream.put(OwnerMode.Complete, WireSize.Mode)
    for (const center of this.centers) countryCodec.write(stream, owners[center] ?? PowerKind.Neutral, this)
    return stream
  }

  private changedOwners(owners: Record<string, string>): Bits {
    const stream = new Bits()
    const changes = this.centers.filter((center) => owners[center] !== this.opening.supplyCenters[center])
    stream.put(changes.length ? OwnerMode.Changes : OwnerMode.Opening, WireSize.Mode)
    if (!changes.length) return stream
    stream.integer(changes.length)
    for (const center of changes) this.writeOwnerChange(stream, center, owners)
    return stream
  }

  private writeOwnerChange(stream: Bits, center: string, owners: Record<string, string>): void {
    const index = this.centers.indexOf(center)
    const owner = owners[center] ?? PowerKind.Neutral
    stream.put(index, this.centerBits)
    countryCodec.write(stream, owner, this)
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
      const owner = countryCodec.read(stream, this)
      if (owner !== PowerKind.Neutral) owners[center] = owner
    }
  }

  private readChangedOwners(stream: Bits, owners: Record<string, string>): void {
    const count = stream.integer()
    for (let index = WireBit.Zero; index < count; index++) this.readOwnerChange(stream, owners)
  }

  private readOwnerChange(stream: Bits, owners: Record<string, string>): void {
    const center = this.centers[stream.get(this.centerBits)]
    const owner = countryCodec.read(stream, this)
    assert(center)
    if (owner === PowerKind.Neutral) delete owners[center]
    else owners[center] = owner
  }

  encode(stream: Bits, board: BoardState, force = false): void {
    const opening = !force && equal(board, this.opening)
    stream.put(opening ? WireBit.One : WireBit.Zero, WireBit.One)
    if (opening) return
    stream.integer(board.year)
    stream.put(board.season === SeasonKind.Fall ? WireBit.One : WireBit.Zero, WireBit.One)
    stream.put(phases.indexOf(board.phase), WireSize.Phase)
    this.unitList(stream, board.units, force)
    this.owners(stream, board.supplyCenters, force)
    this.writeDislodged(stream, board.dislodged)
    this.writeContested(stream, board.contested)
  }

  private writeDislodged(stream: Bits, units: BoardState['dislodged']): void {
    stream.integer(units.length)
    for (const entry of units) {
      unitCodec.write(stream, entry.unit, this)
      optionalPlace.write(stream, entry.attackedFrom, this)
    }
  }

  private writeContested(stream: Bits, regions: string[]): void {
    stream.integer(regions.length)
    for (const region of [...regions].sort()) provinceCodec.write(stream, region, this)
  }

  decode(stream: Bits): BoardState {
    if (stream.get(WireBit.One)) return structuredClone(this.opening)
    const year = stream.integer()
    const season = stream.get(WireBit.One) ? SeasonKind.Fall : SeasonKind.Spring
    const phase = phases[stream.get(WireSize.Mode)]
    assert(phase)
    const units = this.unitList(stream)
    const supplyCenters = this.owners(stream)
    const dislodged = this.readDislodged(stream)
    const contested = this.readContested(stream)
    return { mapId: this.map.id, year, season, phase, units, supplyCenters, dislodged, contested }
  }

  private readDislodged(stream: Bits): BoardState['dislodged'] {
    const count = bounded(stream.integer(), WireLimit.ListItems)
    return Array.from({ length: count }, () => this.readDislodgedUnit(stream))
  }

  private readDislodgedUnit(stream: Bits): BoardState['dislodged'][number] {
    const unit = unitCodec.read(stream, this)
    const attackedFrom = optionalPlace.read(stream, this) ?? EMPTY_TEXT
    return { unit, attackedFrom }
  }

  private readContested(stream: Bits): string[] {
    const count = bounded(stream.integer(), WireLimit.ListItems)
    return Array.from({ length: count }, () => provinceCodec.read(stream, this))
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
  encode(stream: Bits, sandbox: SandboxContent): void {
    const mapCode = sandbox.mapId === MapKind.Variant1900 ? WireBit.One : WireBit.Zero
    stream.put(mapCode, WireBit.One)
    stream.put(RULES_ID, WireSize.Checksum)
    stream.text(sandbox.name)
    stream.integer(sandbox.frames.length)
    stream.integer(sandbox.cursor)
  }

  decode(stream: Bits): FrameHeader {
    const mapId = stream.get(WireBit.One) ? MapKind.Variant1900 : MapKind.Classical
    assertEqual(stream.get(WireSize.Checksum), RULES_ID)
    const name = stream.text()
    const count = stream.integer()
    const cursor = stream.integer()
    assert(count > WireBit.Zero && count <= WireLimit.Frames && cursor < count && name.length <= WireLimit.StringChars)
    return { mapId, name, count, cursor }
  }
}

/** A frame delegates orders and optional board checkpoints to their codecs. */
class FrameCodec {
  constructor(private readonly format: OrderCodec) {}

  encode(stream: Bits, frame: Frame, entry: TimelineEntry, hasNext: boolean): void {
    assert(entry.orders.length <= WireLimit.Orders)
    this.format.encode(stream, frame.board, entry.orders)
    stream.put(entry.showResults ? WireBit.One : WireBit.Zero, WireBit.One)
    if (!hasNext) return
    stream.put(entry.checkpoint ? WireBit.One : WireBit.Zero, WireBit.One)
    if (entry.checkpoint) this.format.boards.encode(stream, entry.checkpoint)
  }

  decode(stream: Bits, board: BoardState, hasNext: boolean): { frame: Frame; next?: BoardState } {
    const orders = this.format.decode(stream, board)
    assert(orders.length <= WireLimit.Orders)
    const show = stream.get(WireBit.One)
    const result = show || hasNext ? adjudicate(this.format.map, board, orders) : undefined
    const frame = this.frame(board, orders, show, result)
    const next = hasNext ? this.readNext(stream, result) : undefined
    return { frame, next }
  }

  private frame(board: BoardState, orders: AnyOrder[], show: number, result?: AdjudicationResult): Frame {
    if (show) assert(result)
    const results = show && result ? { results: result.results } : {}
    return { board, orders, ...results }
  }

  private readNext(stream: Bits, result?: AdjudicationResult): BoardState {
    assert(result)
    return stream.get(WireBit.One) ? this.format.boards.decode(stream) : result.newBoardState
  }
}

/** Write a snapshot and each subsequent frame without changing their stored order. */
class SandboxWriter {
  private readonly stream = new Bits()
  private readonly format: OrderCodec
  private readonly metadata = new MetadataCodec()
  private readonly frameCodec: FrameCodec

  constructor(
    private readonly sandbox: SandboxContent,
    private readonly timeline: ShareTimeline,
  ) {
    const validMap = sandbox.mapId === MapKind.Classical || sandbox.mapId === MapKind.Variant1900
    assert(validMap)
    this.format = new OrderCodec(new BoardCodec(maps[sandbox.mapId]))
    this.frameCodec = new FrameCodec(this.format)
  }

  encode(): Uint8Array {
    this.validateCursor()
    this.writeHeader()
    this.writeFrames()
    this.writeChecksum()
    const raw = this.stream.bytes()
    return WireEnvelope.encode(raw)
  }

  private validateCursor(): void {
    const count = this.sandbox.frames.length
    const cursor = this.sandbox.cursor
    assert(count > WireBit.Zero && count <= WireLimit.Frames && cursor >= WireBit.Zero && cursor < count)
  }

  private writeHeader(): void {
    this.metadata.encode(this.stream, this.sandbox)
    this.format.boards.encode(this.stream, this.sandbox.frames[WireBit.Zero].board)
  }

  private writeFrames(): void {
    const frames = this.sandbox.frames
    for (let index = WireBit.Zero; index < frames.length; index++) {
      const hasNext = index + WireBit.One < frames.length
      this.frameCodec.encode(this.stream, frames[index], this.timeline.entries[index], hasNext)
    }
  }

  private writeChecksum(): void {
    const frame = this.sandbox.frames.at(WireIndex.Missing)
    assert(frame)
    const checksum = this.format.boards.boardChecksum(frame.board)
    this.stream.put(checksum, WireSize.Checksum)
  }
}

/** Read a version 1 stream and reconstruct frames using the existing adjudicator. */
class SandboxReader {
  private readonly format: OrderCodec
  private readonly frames: SandboxContent['frames'] = []
  private readonly frameCodec: FrameCodec
  private board: BoardState

  constructor(
    private readonly stream: Bits,
    private readonly header: FrameHeader,
  ) {
    this.format = new OrderCodec(new BoardCodec(maps[header.mapId]))
    this.frameCodec = new FrameCodec(this.format)
    this.board = this.format.boards.decode(stream)
  }

  static decode(envelope: Uint8Array): SandboxContent {
    const raw = WireEnvelope.decode(envelope)
    const stream = new Bits(raw)
    const header = new MetadataCodec().decode(stream)
    const reader = new SandboxReader(stream, header)
    return reader.read()
  }

  private read(): SandboxContent {
    for (let index = WireBit.Zero; index < this.header.count; index++) this.readFrame(index)
    this.checkResult()
    const { name, mapId, cursor } = this.header
    return { name, mapId, frames: this.frames, cursor }
  }

  private readFrame(index: number): void {
    const hasNext = index < this.header.count - WireBit.One
    const result = this.frameCodec.decode(this.stream, this.board, hasNext)
    this.frames.push(result.frame)
    if (result.next) this.board = result.next
  }

  private checkResult(): void {
    const actual = this.format.boards.boardChecksum(this.board)
    const expected = this.stream.get(WireSize.Checksum)
    assertEqual(actual, expected)
    assert(this.stream.data.length - this.stream.pos < WireSize.Byte)
    while (this.stream.pos < this.stream.data.length) assertEqual(this.stream.get(WireBit.One), WireBit.Zero)
  }
}

const encodeSandbox = (sandbox: SandboxContent, timeline: ShareTimeline): Uint8Array =>
  new SandboxWriter(sandbox, timeline).encode()
const decodeSandbox = (envelope: Uint8Array): SandboxContent => SandboxReader.decode(envelope)

export { decodeSandbox, encodeSandbox, equal }
