import { adjudicate } from '../adjudicator'
import type { AdjudicationResult, AnyOrder, BoardState } from '../adjudicator'
import type { MapDefinition } from '../mapDefinition'
import { getMap } from '../maps'
import type { Frame, Sandbox } from '../sandbox'
import type { Unit } from '../types'
import { CanonicalValue } from './canonical'
import { OrderKind, PhaseKind, SeasonKind, UnitKind, WireBit, WireLimit } from './wire'

/** Portable content is independent of local sandbox identity and storage. */
export type SandboxContent = Pick<Sandbox, 'name' | 'mapId' | 'frames' | 'cursor'>

export interface TimelineEntry {
  orders: AnyOrder[]
  showResults: boolean
  /** Next board, stored only when replay cannot reconstruct it. */
  checkpoint?: BoardState
}

export interface ShareTimeline {
  name: string
  mapId: string
  initialBoard: BoardState
  cursor: number
  entries: TimelineEntry[]
}

type OrderFields = AnyOrder & {
  target?: string
  aux?: string
  targetCoast?: string
  viaConvoy?: boolean
  unitType?: string
}

const ORDER_TYPES: readonly string[] = Object.values(OrderKind)
const PHASE_TYPES: readonly string[] = Object.values(PhaseKind)
const SEASON_TYPES: readonly string[] = Object.values(SeasonKind)
const UNIT_TYPES: readonly string[] = Object.values(UnitKind)
const TIMELINE_ERROR = 'Invalid sandbox timeline'
const INVALID_BOARD = 'Invalid sandbox board'
const INVALID_ORDERS = 'Invalid sandbox orders'
const STALE_RESULTS = 'Stored resolution results do not match this engine'

function checkCursor(cursor: number, count: number): void {
  const invalid =
    !count || count > WireLimit.Frames || !Number.isInteger(cursor) || cursor < WireBit.Zero || cursor >= count
  if (invalid) throw Error(TIMELINE_ERROR)
}

/** Validate board structure independently of the encoded representation. */
class BoardValidator {
  private readonly powers: Set<string>
  private readonly limit: number

  constructor(private readonly map: MapDefinition) {
    this.powers = new Set(map.powers.map((power) => power.id))
    this.limit = Object.keys(map.territories).length
  }

  validate(board: BoardState): void {
    this.checkRound(board)
    this.checkUnits(board.units)
    this.checkOwners(board.supplyCenters)
    this.checkDislodged(board.dislodged)
    this.checkContested(board.contested)
  }

  private checkRound(board: BoardState): void {
    if (board.mapId !== this.map.id) throw Error(INVALID_BOARD)
    if (!Number.isSafeInteger(board.year)) throw Error(INVALID_BOARD)
    if (board.year < WireBit.One || board.year > WireLimit.Integer) throw Error(INVALID_BOARD)
    if (!SEASON_TYPES.includes(board.season)) throw Error(INVALID_BOARD)
    if (!PHASE_TYPES.includes(board.phase)) throw Error(INVALID_BOARD)
  }

  private checkUnits(units: Unit[]): void {
    if (!Array.isArray(units) || units.length > this.limit) throw Error(INVALID_BOARD)
    if (units.some((unit) => !this.validUnit(unit))) throw Error(INVALID_BOARD)
    const provinces = new Set(units.map((unit) => unit.territory))
    if (provinces.size !== units.length) throw Error(INVALID_BOARD)
  }

  private validUnit(unit: Unit): boolean {
    const territory = this.map.territories[unit.territory]
    if (!territory || !this.powers.has(unit.nation)) return false
    if (!UNIT_TYPES.includes(unit.type)) return false
    if (unit.type === UnitKind.Army && territory.type === 'sea') return false
    if (unit.type === UnitKind.Fleet && territory.type === 'land') return false
    if (unit.coast && !territory.coasts?.[unit.coast]) return false
    return true
  }

  private checkOwners(owners: Record<string, string>): void {
    if (!owners) throw Error(INVALID_BOARD)
    for (const [province, nation] of Object.entries(owners)) {
      if (!this.map.territories[province]?.supplyCenter) throw Error(INVALID_BOARD)
      if (!this.powers.has(nation)) throw Error(INVALID_BOARD)
    }
  }

  private checkDislodged(units: BoardState['dislodged']): void {
    if (!Array.isArray(units) || units.length > this.limit) throw Error(INVALID_BOARD)
    for (const entry of units) {
      if (!this.validUnit(entry.unit)) throw Error(INVALID_BOARD)
      if (entry.attackedFrom && !this.map.territories[entry.attackedFrom]) throw Error(INVALID_BOARD)
    }
  }

  private checkContested(provinces: string[]): void {
    if (!Array.isArray(provinces) || provinces.length > this.limit) throw Error(INVALID_BOARD)
    if (provinces.some((province) => !this.map.territories[province])) throw Error(INVALID_BOARD)
  }
}

/** Validate order shape while allowing deliberate, adjudicator-visible illegal orders. */
class OrderValidator {
  private readonly powers: Set<string>
  private readonly coasts: Set<string>

  constructor(private readonly map: MapDefinition) {
    this.powers = new Set(map.powers.map((power) => power.id))
    this.coasts = new Set(Object.values(map.territories).flatMap((area) => Object.keys(area.coasts ?? {})))
  }

  validate(orders: AnyOrder[]): void {
    if (!Array.isArray(orders) || orders.length > WireLimit.Orders) throw Error(INVALID_ORDERS)
    if (orders.some((order) => !this.validOrder(order))) throw Error(INVALID_ORDERS)
  }

  private validOrder(order: OrderFields): boolean {
    if (!order || !ORDER_TYPES.includes(order.type)) return false
    if (!this.powers.has(order.nation) || !this.map.territories[order.source]) return false
    if (!this.validTargets(order)) return false
    return this.validOptions(order)
  }

  private validTargets(order: OrderFields): boolean {
    if (order.target !== undefined && !this.map.territories[order.target]) return false
    if (order.aux !== undefined && !this.map.territories[order.aux]) return false
    return true
  }

  private validOptions(order: OrderFields): boolean {
    if (order.sourceCoast !== undefined && !this.coasts.has(order.sourceCoast)) return false
    if (order.targetCoast !== undefined && !this.coasts.has(order.targetCoast)) return false
    if (order.viaConvoy !== undefined && typeof order.viaConvoy !== 'boolean') return false
    if (order.unitType !== undefined && !UNIT_TYPES.includes(order.unitType)) return false
    return true
  }
}

/** Build a portable timeline from the existing sandbox frames. */
class TimelineWriter {
  private readonly map: MapDefinition
  private readonly boards: BoardValidator
  private readonly orders: OrderValidator

  constructor(private readonly sandbox: SandboxContent) {
    this.map = getMap(sandbox.mapId)
    this.boards = new BoardValidator(this.map)
    this.orders = new OrderValidator(this.map)
  }

  write(): ShareTimeline {
    checkCursor(this.sandbox.cursor, this.sandbox.frames.length)
    const entries = this.sandbox.frames.map((frame, index) => this.writeEntry(frame, index))
    const { name, mapId, cursor, frames } = this.sandbox
    const initialBoard = structuredClone(frames[WireBit.Zero].board)
    return { name, mapId, initialBoard, cursor, entries }
  }

  private writeEntry(frame: Frame, index: number): TimelineEntry {
    this.boards.validate(frame.board)
    this.orders.validate(frame.orders)
    const next = this.sandbox.frames[index + WireBit.One]
    const result = this.resolve(frame, Boolean(next))
    this.checkResults(frame, result)
    const checkpoint = this.checkpoint(next, result)
    const orders = structuredClone(frame.orders)
    return { orders, showResults: frame.results !== undefined, ...(checkpoint ? { checkpoint } : {}) }
  }

  private resolve(frame: Frame, hasNext: boolean): AdjudicationResult | undefined {
    if (!hasNext && !frame.results) return undefined
    return adjudicate(this.map, frame.board, frame.orders)
  }

  private checkResults(frame: Frame, result?: AdjudicationResult): void {
    if (!frame.results) return
    if (!CanonicalValue.equal(frame.results, result?.results)) throw Error(STALE_RESULTS)
  }

  private checkpoint(next?: Frame, result?: AdjudicationResult): BoardState | undefined {
    if (!next || CanonicalValue.equal(next.board, result?.newBoardState)) return undefined
    return structuredClone(next.board)
  }
}

/** Reconstruct the same frame shape used by the sandbox store. */
class TimelineReader {
  private readonly map: MapDefinition
  private readonly boards: BoardValidator
  private readonly frames: Frame[] = []
  private board: BoardState

  constructor(private readonly timeline: ShareTimeline) {
    this.map = getMap(timeline.mapId)
    this.boards = new BoardValidator(this.map)
    this.boards.validate(timeline.initialBoard)
    this.board = structuredClone(timeline.initialBoard)
  }

  read(): SandboxContent {
    checkCursor(this.timeline.cursor, this.timeline.entries.length)
    this.timeline.entries.forEach((entry, index) => this.readEntry(entry, index))
    const { name, mapId, cursor } = this.timeline
    return { name, mapId, frames: this.frames, cursor }
  }

  private readEntry(entry: TimelineEntry, index: number): void {
    const next = index + WireBit.One < this.timeline.entries.length
    if (!next && entry.checkpoint) throw Error('Checkpoint beyond last frame')
    if (entry.checkpoint) this.boards.validate(entry.checkpoint)
    const orders = structuredClone(entry.orders)
    const result = next || entry.showResults ? adjudicate(this.map, this.board, orders) : undefined
    const results = entry.showResults ? { results: result?.results } : {}
    this.frames.push({ board: this.board, orders, ...results })
    if (next && result) this.advance(entry, result)
  }

  private advance(entry: TimelineEntry, result: AdjudicationResult): void {
    this.board = entry.checkpoint ? structuredClone(entry.checkpoint) : result.newBoardState
  }
}

export function toTimeline(sandbox: SandboxContent): ShareTimeline {
  const writer = new TimelineWriter(sandbox)
  return writer.write()
}

export function fromTimeline(timeline: ShareTimeline): SandboxContent {
  const reader = new TimelineReader(timeline)
  return reader.read()
}
