import { buildSituation } from '../orders/adjustments'
import { sortUnits } from '../adjudicator/state'
import type { AnyOrder, BoardState, Phase } from '../adjudicator'
import type { MapDefinition } from '../mapDefinition'
import type { Unit } from '../types'
import { sortedChoices } from './bits'
import { CanonicalValue } from './canonical'
import type { BoardCodec } from './codec'
import { countryCodec, provinceCodec, optionalPlace, coastCodec } from './fields'
import {
  ConvoyOrderCodec,
  SupportOrderCodec,
  ConvoyedArmiesCodec,
  MoveOrderCodec,
  RetreatOrderCodec,
  type WireOrder,
} from './order-codecs'
import {
  bounded,
  AUX_ACTIONS,
  BUILD_TYPES,
  COAST_ACTIONS,
  TARGET_ACTIONS,
  requireEqual as assertEqual,
  requireWire as assert,
  WireStream as Bits,
  MovementCode,
  MovementWidth,
  OrderKind,
  PhaseKind,
  UnitKind,
  WireBit,
  WireLimit,
  WireSize,
} from './wire'

type WireSource = Pick<WireOrder, 'nation' | 'source' | 'sourceCoast'>
const stable = CanonicalValue.normalize.bind(CanonicalValue)
const equal = CanonicalValue.equal.bind(CanonicalValue)

/** Compact builds and removals share a board-derived dictionary. */
class BuildOrdersCodec {
  constructor(private readonly map: MapDefinition) {}

  buildChoices(board: BoardState): string[] {
    const orders: WireOrder[] = []
    for (const power of this.map.powers) this.appendBuildOrders(board, power.id, orders)
    return orders.map((order) => JSON.stringify(stable(order))).sort()
  }

  private appendBuildOrders(board: BoardState, nation: string, orders: WireOrder[]): void {
    const state = buildSituation(this.map, nation, board.supplyCenters, board.units)
    if (state.delta > WireBit.Zero) {
      this.appendBuilds(nation, state.spots, orders)
      return
    }
    if (state.delta < WireBit.Zero) this.appendRemovals(nation, state.removable, orders)
  }

  private appendBuilds(nation: string, spots: ReturnType<typeof buildSituation>['spots'], orders: WireOrder[]): void {
    for (const spot of spots) {
      for (const type of spot.types) this.appendBuildTypes(nation, spot, type, orders)
    }
  }

  private appendBuildTypes(
    nation: string,
    spot: ReturnType<typeof buildSituation>['spots'][number],
    type: Unit['type'],
    orders: WireOrder[],
  ): void {
    const coasts = type === UnitKind.Fleet && spot.coasts?.length ? [undefined, ...spot.coasts] : [undefined]
    for (const coast of coasts) {
      const source = spot.province
      orders.push({ type: OrderKind.Build, nation, source, unitType: type, ...(coast ? { sourceCoast: coast } : {}) })
    }
  }

  private appendRemovals(nation: string, units: Unit[], orders: WireOrder[]): void {
    for (const unit of units) {
      const coasts = unit.coast ? [undefined, unit.coast] : [undefined]
      for (const coast of coasts) this.appendRemoval(nation, unit, coast, orders)
    }
  }

  private appendRemoval(nation: string, unit: Unit, coast: string | undefined, orders: WireOrder[]): void {
    const source = unit.territory
    orders.push({ type: OrderKind.Remove, nation, source, ...(coast ? { sourceCoast: coast } : {}) })
  }

  encode(stream: Bits, board: BoardState, orders: WireOrder[]): void {
    const choices = this.buildChoices(board)
    stream.integer(orders.length)
    for (const order of orders) sortedChoices(choices).write(stream, JSON.stringify(stable(order)), undefined)
  }

  decode(stream: Bits, board: BoardState): AnyOrder[] {
    const choices = this.buildChoices(board)
    const count = bounded(stream.integer(), WireLimit.ListItems)
    return Array.from({ length: count }, () => JSON.parse(sortedChoices(choices).read(stream, undefined)) as AnyOrder)
  }
}

/** Shared board-derived information used by both order representations. */
class OrderContext {
  constructor(
    readonly map: MapDefinition,
    readonly boards: BoardCodec,
  ) {}

  roster(board: BoardState): Unit[] {
    return sortUnits(board.phase === PhaseKind.Retreat ? board.dislodged.map((entry) => entry.unit) : board.units)
  }

  sourceIndex(roster: Unit[], order: WireOrder): number {
    return roster.findIndex(
      (unit) => unit.nation === order.nation && unit.territory === order.source && unit.coast === order.sourceCoast,
    )
  }

  orderedIndexes(indexes: number[]): boolean {
    return indexes.every(
      (value, index) => value >= WireBit.Zero && (index === WireBit.Zero || value > indexes[index - WireBit.One]),
    )
  }

  unitSource(unit: Unit): WireSource {
    return { nation: unit.nation, source: unit.territory, ...(unit.coast ? { sourceCoast: unit.coast } : {}) }
  }
}

/** Fallback representation preserves incomplete or illegal draft orders. */
class GenericOrderCodec {
  constructor(private readonly context: OrderContext) {}

  private writeSource(stream: Bits, roster: Unit[], order: WireOrder): void {
    const width = Math.ceil(Math.log2(Math.max(WireBit.One, roster.length)))
    const index = this.context.sourceIndex(roster, order)
    stream.put(index >= WireBit.Zero ? WireBit.One : WireBit.Zero, WireBit.One)
    if (index >= WireBit.Zero) {
      stream.put(index, width)
      return
    }
    countryCodec.write(stream, order.nation, this.context.boards)
    provinceCodec.write(stream, order.source, this.context.boards)
    coastCodec.write(stream, order.sourceCoast, this.context.boards)
  }

  private readSource(stream: Bits, roster: Unit[]): WireSource {
    const width = Math.ceil(Math.log2(Math.max(WireBit.One, roster.length)))
    if (stream.get(WireBit.One)) return this.readIndexedSource(stream, roster, width)
    const nation = countryCodec.read(stream, this.context.boards)
    const source = provinceCodec.read(stream, this.context.boards)
    const coast = coastCodec.read(stream, this.context.boards)
    return { nation, source, ...(coast ? { sourceCoast: coast } : {}) }
  }

  private readIndexedSource(stream: Bits, roster: Unit[], width: number): WireSource {
    const unit = roster[stream.get(width)]
    assert(unit)
    return { nation: unit.nation, source: unit.territory, ...(unit.coast ? { sourceCoast: unit.coast } : {}) }
  }

  private actionTypes(phase: Phase): WireOrder['type'][] {
    if (phase === PhaseKind.Movement) return [OrderKind.Hold, OrderKind.Support, OrderKind.Move, OrderKind.Convoy]
    if (phase === PhaseKind.Retreat) return [OrderKind.Disband, OrderKind.Retreat]
    return [OrderKind.Remove, OrderKind.Build]
  }

  private actionWidth(phase: Phase): number {
    return phase === PhaseKind.Movement ? WireSize.Movement : WireBit.One
  }

  private writeAction(stream: Bits, phase: Phase, order: WireOrder): void {
    const types = this.actionTypes(phase)
    const code = types.indexOf(order.type)
    stream.put(code, this.actionWidth(phase))
    this.writeActionTargets(stream, order)
    this.writeActionOptions(stream, order)
  }

  private writeActionTargets(stream: Bits, order: WireOrder): void {
    if (AUX_ACTIONS.includes(order.type)) optionalPlace.write(stream, order.aux, this.context.boards)
    if (TARGET_ACTIONS.includes(order.type)) optionalPlace.write(stream, order.target, this.context.boards)
  }

  private writeActionOptions(stream: Bits, order: WireOrder): void {
    if (COAST_ACTIONS.includes(order.type)) coastCodec.write(stream, order.targetCoast, this.context.boards)
    if (order.type === OrderKind.Move) stream.put(order.viaConvoy ? WireBit.One : WireBit.Zero, WireBit.One)
    if (order.type === OrderKind.Build) stream.put(BUILD_TYPES.indexOf(order.unitType), WireSize.UnitType)
  }

  private readAction(stream: Bits, phase: Phase): Pick<WireOrder, 'type'> & Partial<WireOrder> {
    const types = this.actionTypes(phase)
    const type = types[stream.get(this.actionWidth(phase))]
    assert(type)
    const order: Pick<WireOrder, 'type'> & Partial<WireOrder> = { type }
    this.readActionTargets(stream, order)
    this.readActionOptions(stream, order)
    return order
  }

  private readActionTargets(stream: Bits, order: WireOrder | (Pick<WireOrder, 'type'> & Partial<WireOrder>)): void {
    if (AUX_ACTIONS.includes(order.type)) order.aux = optionalPlace.read(stream, this.context.boards)
    if (TARGET_ACTIONS.includes(order.type)) order.target = optionalPlace.read(stream, this.context.boards)
  }

  private readActionOptions(stream: Bits, order: WireOrder | (Pick<WireOrder, 'type'> & Partial<WireOrder>)): void {
    if (COAST_ACTIONS.includes(order.type)) order.targetCoast = coastCodec.read(stream, this.context.boards)
    if (order.type === OrderKind.Move && stream.get(WireBit.One)) order.viaConvoy = true
    if (order.type !== OrderKind.Build) return
    const unitType = BUILD_TYPES[stream.get(WireSize.Mode)]
    if (unitType) order.unitType = unitType
  }

  encode(stream: Bits, board: BoardState, orders: WireOrder[]): void {
    const roster = this.context.roster(board)
    const sparse = this.sparseOrders(board.phase, roster, orders)
    const indexes = orders.map((order) => this.context.sourceIndex(roster, order))
    const dense = this.context.orderedIndexes(indexes) ? this.denseOrders(board, roster, orders, indexes) : undefined
    const useDense = Boolean(dense && dense.length < sparse.length)
    const selected = useDense && dense ? dense : sparse
    stream.append(selected)
  }

  private sparseOrders(phase: Phase, roster: Unit[], orders: WireOrder[]): Bits {
    const stream = new Bits()
    stream.put(WireBit.Zero, WireBit.One)
    stream.integer(orders.length)
    for (const order of orders) {
      this.writeSource(stream, roster, order)
      this.writeAction(stream, phase, order)
    }
    return stream
  }

  private denseOrders(board: BoardState, roster: Unit[], orders: WireOrder[], indexes: number[]): Bits {
    const stream = new Bits()
    stream.put(WireBit.One, WireBit.One)
    for (let index = WireBit.Zero; index < roster.length; index++) {
      const position = indexes.indexOf(index)
      stream.put(position >= WireBit.Zero ? WireBit.One : WireBit.Zero, WireBit.One)
      if (position >= WireBit.Zero) this.writeAction(stream, board.phase, orders[position])
    }
    return stream
  }

  decode(stream: Bits, board: BoardState): AnyOrder[] {
    const roster = this.context.roster(board)
    if (stream.get(WireBit.One)) return this.readDenseOrders(stream, board, roster)
    const count = bounded(stream.integer(), WireLimit.ListItems)
    return Array.from({ length: count }, () => this.readSparseOrder(stream, board.phase, roster))
  }

  private readDenseOrders(stream: Bits, board: BoardState, roster: Unit[]): AnyOrder[] {
    const orders: AnyOrder[] = []
    for (const unit of roster) {
      if (!stream.get(WireBit.One)) continue
      const source = this.context.unitSource(unit)
      const action = this.readAction(stream, board.phase)
      orders.push({ ...source, ...action } as AnyOrder)
    }
    return orders
  }

  private readSparseOrder(stream: Bits, phase: Phase, roster: Unit[]): AnyOrder {
    const source = this.readSource(stream, roster)
    const action = this.readAction(stream, phase)
    return { ...source, ...action } as AnyOrder
  }
}

/** Board-aware representation for compact legal-looking orders. */
class CompactOrderCodec {
  private readonly builds: BuildOrdersCodec
  private readonly move = new MoveOrderCodec()
  private readonly retreat = new RetreatOrderCodec()
  private readonly support = new SupportOrderCodec()
  private readonly convoy = new ConvoyOrderCodec()
  private readonly convoyed: ConvoyedArmiesCodec

  constructor(private readonly context: OrderContext) {
    this.builds = new BuildOrdersCodec(context.map)
    this.convoyed = new ConvoyedArmiesCodec(context.map)
  }

  private writeCompactAction(
    stream: Bits,
    board: BoardState,
    unit: Unit,
    order: WireOrder,
    viaSet?: Set<string>,
  ): void {
    if (board.phase === PhaseKind.Movement) {
      this.writeMovement(stream, board, unit, order, viaSet)
      return
    }
    this.retreat.encode(stream, order, { map: this.context.map, board, unit, fields: this.context.boards })
  }

  private readCompactAction(stream: Bits, board: BoardState, unit: Unit, viaSet?: Set<string>): AnyOrder {
    if (board.phase === PhaseKind.Movement) return this.readMovement(stream, board, unit, viaSet)
    return this.retreat.decode(stream, { map: this.context.map, board, unit, fields: this.context.boards })
  }

  private writeMovement(stream: Bits, board: BoardState, unit: Unit, order: WireOrder, viaSet?: Set<string>): void {
    const codes: Partial<Record<WireOrder['type'], number[]>> = {
      [OrderKind.Move]: [MovementCode.Move, MovementWidth.Move],
      [OrderKind.Support]: [MovementCode.Support, MovementWidth.Support],
      [OrderKind.Hold]: [MovementCode.Hold, MovementWidth.Hold],
      [OrderKind.Convoy]: [MovementCode.Convoy, MovementWidth.Convoy],
    }
    const code = codes[order.type]
    assert(code)
    stream.put(code[WireBit.Zero], code[WireBit.One])
    if (order.type === OrderKind.Move)
      this.move.encode(stream, order, { map: this.context.map, board, unit, fields: this.context.boards, vias: viaSet })
    const context = { map: this.context.map, board, unit }
    if (order.type === OrderKind.Support) this.support.encode(stream, order, context)
    if (order.type === OrderKind.Convoy) this.convoy.encode(stream, order, context)
  }

  private readMovement(stream: Bits, board: BoardState, unit: Unit, viaSet?: Set<string>): AnyOrder {
    const source = this.context.unitSource(unit)
    const type = this.readMovementType(stream)
    if (type === OrderKind.Move)
      return {
        ...source,
        ...this.move.decode(stream, { map: this.context.map, board, unit, fields: this.context.boards, vias: viaSet }),
      }
    if (type === OrderKind.Hold) return { ...source, type }
    const codec = type === OrderKind.Support ? this.support : this.convoy
    const order = codec.decode(stream, { map: this.context.map, board, unit })
    return { ...source, ...order }
  }

  private readMovementType(stream: Bits): OrderKind.Move | OrderKind.Support | OrderKind.Hold | OrderKind.Convoy {
    if (!stream.get(WireBit.One)) return OrderKind.Move
    if (!stream.get(WireBit.One)) return OrderKind.Support
    if (!stream.get(WireBit.One)) return OrderKind.Hold
    return OrderKind.Convoy
  }

  encode(stream: Bits, board: BoardState, orders: WireOrder[]): void {
    if (board.phase === PhaseKind.Build) {
      this.builds.encode(stream, board, orders)
      return
    }
    this.writeCompactRoster(stream, board, orders)
  }

  decode(stream: Bits, board: BoardState): AnyOrder[] {
    if (board.phase === PhaseKind.Build) return this.builds.decode(stream, board)
    return this.readCompactRoster(stream, board)
  }

  private writeCompactRoster(stream: Bits, board: BoardState, orders: WireOrder[]): void {
    const roster = this.context.roster(board)
    const indexes = orders.map((order) => this.context.sourceIndex(roster, order))
    assert(this.context.orderedIndexes(indexes))
    const vias = board.phase === PhaseKind.Movement ? this.convoyed.encode(stream, board, orders) : undefined
    const all = orders.length === roster.length
    stream.put(all ? WireBit.One : WireBit.Zero, WireBit.One)
    for (let index = WireBit.Zero; index < roster.length; index++) {
      this.writeRosterOrder(stream, board, roster[index], orders, indexes, index, all, vias)
    }
  }

  private writeRosterOrder(
    stream: Bits,
    board: BoardState,
    unit: Unit,
    orders: WireOrder[],
    indexes: number[],
    index: number,
    all: boolean,
    vias?: Set<string>,
  ): void {
    const position = indexes.indexOf(index)
    if (!all) stream.put(position >= WireBit.Zero ? WireBit.One : WireBit.Zero, WireBit.One)
    if (position >= WireBit.Zero) this.writeCompactAction(stream, board, unit, orders[position], vias)
  }

  private readCompactRoster(stream: Bits, board: BoardState): AnyOrder[] {
    const roster = this.context.roster(board)
    const vias = board.phase === PhaseKind.Movement ? this.convoyed.decode(stream, board) : undefined
    const all = stream.get(WireBit.One)
    const orders: AnyOrder[] = []
    for (const unit of roster) {
      if (all || stream.get(WireBit.One)) orders.push(this.readCompactAction(stream, board, unit, vias))
    }
    return orders
  }
}

/** Try both representations and choose the smallest valid result. */
export class OrderCodec {
  readonly boards: BoardCodec
  private readonly generic: GenericOrderCodec
  private readonly compact: CompactOrderCodec

  readonly map: MapDefinition

  constructor(boards: BoardCodec) {
    this.boards = boards
    this.map = boards.map
    const context = new OrderContext(this.map, boards)
    this.generic = new GenericOrderCodec(context)
    this.compact = new CompactOrderCodec(context)
  }

  decode(stream: Bits, board: BoardState): AnyOrder[] {
    return stream.get(WireBit.One) ? this.compact.decode(stream, board) : this.generic.decode(stream, board)
  }

  encode(stream: Bits, board: BoardState, orders: WireOrder[]): void {
    const generic = new Bits()
    generic.put(WireBit.Zero, WireBit.One)
    this.generic.encode(generic, board, orders)
    const compact = this.compactCandidate(board, orders)
    const selected = compact && compact.length < generic.length ? compact : generic
    stream.append(selected)
  }

  private compactCandidate(board: BoardState, orders: WireOrder[]): Bits | undefined {
    try {
      const stream = new Bits()
      stream.put(WireBit.One, WireBit.One)
      this.compact.encode(stream, board, orders)
      const reader = new Bits(stream.bytes())
      assertEqual(reader.get(WireBit.One), WireBit.One)
      assert(equal(this.compact.decode(reader, board), orders))
      return stream
    } catch {
      return undefined
    }
  }
}
