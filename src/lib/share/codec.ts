import { adjudicate, initialBoard } from '../adjudicator'
import { maps } from '../maps'
import { OrderCodec } from './order-modes'
import { provinceCodec, optionalPlace, unitCodec } from './fields'
import { BoardOwnersCodec, BoardUnitsCodec } from './board-codecs'
import type { MapDefinition } from '../mapDefinition'
import type { BoardState, Phase } from '../adjudicator'
import type { ShareTimeline, TimelineEntry } from './timeline'
import { CanonicalValue } from './canonical'

import {
  readList,
  writeList,
  EMPTY_TEXT,
  WireIndex,
  PHASE_IDS,
  RULES_ID,
  requireEqual as assertEqual,
  requireWire as assert,
  WireChecksum,
  WireStream as Bits,
  MapKind,
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
  private readonly units = new BoardUnitsCodec(this)
  private readonly owners = new BoardOwnersCodec(this)
  constructor(map: MapDefinition) {
    this.map = map
    this.provinces = Object.keys(map.territories).sort()
    this.centers = this.provinces.filter((province) => map.territories[province].supplyCenter)
    this.provinceBits = Math.ceil(Math.log2(this.provinces.length))
    this.centerBits = Math.ceil(Math.log2(this.centers.length))
    this.opening = initialBoard(map)
  }
  encode(stream: Bits, board: BoardState, force = false): void {
    const opening = !force && equal(board, this.opening)
    stream.put(opening ? WireBit.One : WireBit.Zero, WireBit.One)
    if (opening) return
    stream.writeInteger(board.year)
    stream.put(board.season === SeasonKind.Fall ? WireBit.One : WireBit.Zero, WireBit.One)
    stream.put(phases.indexOf(board.phase), WireSize.Phase)
    this.units.encode(stream, board.units, force)
    this.owners.encode(stream, board.supplyCenters, force)
    this.writeDislodged(stream, board.dislodged)
    this.writeContested(stream, board.contested)
  }

  private writeDislodged(stream: Bits, units: BoardState['dislodged']): void {
    writeList(stream, units, (entry) => {
      unitCodec.encode(stream, entry.unit, this)
      optionalPlace.encode(stream, entry.attackedFrom, this)
    })
  }

  private writeContested(stream: Bits, regions: string[]): void {
    writeList(stream, [...regions].sort(), (region) => provinceCodec.encode(stream, region, this))
  }

  decode(stream: Bits): BoardState {
    if (stream.get(WireBit.One)) return structuredClone(this.opening)
    const year = stream.readInteger()
    const season = stream.get(WireBit.One) ? SeasonKind.Fall : SeasonKind.Spring
    const phase = phases[stream.get(WireSize.Mode)]
    assert(phase)
    const units = this.units.decode(stream)
    const supplyCenters = this.owners.decode(stream)
    const dislodged = this.readDislodged(stream)
    const contested = this.readContested(stream)
    return { mapId: this.map.id, year, season, phase, units, supplyCenters, dislodged, contested }
  }

  private readDislodged(stream: Bits): BoardState['dislodged'] {
    return readList(stream, () => this.readDislodgedUnit(stream))
  }

  private readDislodgedUnit(stream: Bits): BoardState['dislodged'][number] {
    const unit = unitCodec.decode(stream, this)
    const attackedFrom = optionalPlace.decode(stream, this) ?? EMPTY_TEXT
    return { unit, attackedFrom }
  }

  private readContested(stream: Bits): string[] {
    return readList(stream, () => provinceCodec.decode(stream, this))
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
function encodeTimeline(timeline: ShareTimeline): Uint8Array {
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
function decodeTimeline(envelope: Uint8Array): ShareTimeline {
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

export { decodeTimeline, encodeTimeline, equal }
