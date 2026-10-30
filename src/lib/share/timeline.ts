import { adjudicate } from '../adjudicator'
import type { AnyOrder, BoardState } from '../adjudicator'
import type { MapDefinition } from '../mapDefinition'
import { getMap } from '../maps'
import type { Frame, Sandbox } from '../sandbox'
import type { Unit } from '../types'
import { CanonicalValue } from './canonical'
import { countryCodec, provinceCodec } from './fields'
import { OrderKind, PhaseKind, SeasonKind, UnitKind, WireBit, WireLimit } from './wire'

/** Portable content is independent of local sandbox identity and storage. */
export type SandboxContent = Pick<Sandbox, 'name' | 'mapId' | 'frames' | 'cursor'>

export interface TimelineEntry {
  /** Board context for this phase; derived during preparation or replay. */
  board: BoardState
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
  private readonly limit: number

  constructor(private readonly map: MapDefinition) {
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
    if (!territory || !countryCodec.validate(unit.nation, this.map)) return false
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
      if (!countryCodec.validate(nation, this.map)) throw Error(INVALID_BOARD)
    }
  }

  private checkDislodged(units: BoardState['dislodged']): void {
    if (!Array.isArray(units) || units.length > this.limit) throw Error(INVALID_BOARD)
    for (const entry of units) {
      if (!this.validUnit(entry.unit)) throw Error(INVALID_BOARD)
      if (entry.attackedFrom && !provinceCodec.validate(entry.attackedFrom, this.map)) throw Error(INVALID_BOARD)
    }
  }

  private checkContested(provinces: string[]): void {
    if (!Array.isArray(provinces) || provinces.length > this.limit) throw Error(INVALID_BOARD)
    if (provinces.some((province) => !provinceCodec.validate(province, this.map))) throw Error(INVALID_BOARD)
  }
}

/** Validate order shape while allowing deliberate, adjudicator-visible illegal orders. */
class OrderValidator {
  private readonly coasts: Set<string>

  constructor(private readonly map: MapDefinition) {
    this.coasts = new Set(Object.values(map.territories).flatMap((area) => Object.keys(area.coasts ?? {})))
  }

  validate(orders: AnyOrder[]): void {
    if (!Array.isArray(orders) || orders.length > WireLimit.Orders) throw Error(INVALID_ORDERS)
    if (orders.some((order) => !this.validOrder(order))) throw Error(INVALID_ORDERS)
  }

  private validOrder(order: OrderFields): boolean {
    if (!order || !ORDER_TYPES.includes(order.type)) return false
    if (!countryCodec.validate(order.nation, this.map) || !provinceCodec.validate(order.source, this.map)) return false
    if (!this.validTargets(order)) return false
    return this.validOptions(order)
  }

  private validTargets(order: OrderFields): boolean {
    if (order.target !== undefined && !provinceCodec.validate(order.target, this.map)) return false
    if (order.aux !== undefined && !provinceCodec.validate(order.aux, this.map)) return false
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

/** Validate and convert local sandbox frames into portable timeline entries. */
export function toTimeline(sandbox: SandboxContent): ShareTimeline {
  const { name, mapId, cursor, frames } = sandbox
  checkCursor(cursor, frames.length)
  const map = getMap(mapId)
  const boards = new BoardValidator(map)
  const orders = new OrderValidator(map)
  const entries = frames.map((frame, index): TimelineEntry => {
    boards.validate(frame.board)
    orders.validate(frame.orders)
    const next = frames[index + WireBit.One]
    const result = next || frame.results ? adjudicate(map, frame.board, frame.orders) : undefined
    if (frame.results && !CanonicalValue.equal(frame.results, result?.results)) throw Error(STALE_RESULTS)
    const checkpoint =
      next && !CanonicalValue.equal(next.board, result?.newBoardState) ? structuredClone(next.board) : undefined
    return {
      board: structuredClone(frame.board),
      orders: structuredClone(frame.orders),
      showResults: frame.results !== undefined,
      ...(checkpoint ? { checkpoint } : {}),
    }
  })
  return { name, mapId, cursor, initialBoard: structuredClone(frames[WireBit.Zero].board), entries }
}

/** Validate and replay the portable timeline into local sandbox frames. */
export function fromTimeline(timeline: ShareTimeline): SandboxContent {
  const { name, mapId, cursor, entries } = timeline
  const map = getMap(mapId)
  const boards = new BoardValidator(map)
  const orders = new OrderValidator(map)
  let board = structuredClone(timeline.initialBoard)
  boards.validate(board)
  checkCursor(cursor, entries.length)
  const frames: Frame[] = []
  for (const [index, entry] of entries.entries()) {
    const next = index + WireBit.One < entries.length
    if (!next && entry.checkpoint) throw Error('Checkpoint beyond last frame')
    boards.validate(board)
    orders.validate(entry.orders)
    if (!CanonicalValue.equal(entry.board, board)) throw Error(INVALID_BOARD)
    if (entry.checkpoint) boards.validate(entry.checkpoint)
    const current = structuredClone(entry.orders)
    const result = next || entry.showResults ? adjudicate(map, board, current) : undefined
    const results = entry.showResults ? { results: result?.results } : {}
    frames.push({ board, orders: current, ...results })
    if (next && result) board = entry.checkpoint ? structuredClone(entry.checkpoint) : result.newBoardState
  }
  return { name, mapId, frames, cursor }
}
