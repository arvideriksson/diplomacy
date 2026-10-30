import { buildSituation } from '../orders/adjustments'
import { adjudicate, initialBoard } from '../adjudicator'
import { sortUnits } from '../adjudicator/state'
import { maps } from '../maps'
import { choice } from './bits'
import {
  ConvoyOrderCodec,
  SupportOrderCodec,
  ConvoyedArmiesCodec,
  MoveOrderCodec,
  RetreatOrderCodec,
  type WireOrder,
} from './order-codecs'
import { countryCodec, provinceCodec, optionalPlace, coastCodec, unitCodec } from './fields'
import type { MapDefinition } from '../mapDefinition'
import type { Unit } from '../types'
import type { AdjudicationResult, AnyOrder, BoardState, Phase } from '../adjudicator'
import type { SandboxContent } from './timeline'
import type { Frame } from '../sandbox'
import { CanonicalValue } from './canonical'

type WireSource = Pick<WireOrder, 'nation' | 'source' | 'sourceCoast'>

import {
  bounded,
  AUX_ACTIONS,
  BASE64_PADDING,
  BASE64_PLUS,
  BASE64_SLASH,
  Base64Char,
  EMPTY_TEXT,
  PAYLOAD_PATTERN,
  URL_MINUS,
  URL_UNDERLINE,
  WireIndex,
  BUILD_TYPES,
  COAST_ACTIONS,
  TARGET_ACTIONS,
  PHASE_IDS,
  RULES_ID,
  requireEqual as assertEqual,
  requireWire as assert,
  WireChecksum,
  WireStream as Bits,
  ListMode,
  MapKind,
  MovementCode,
  MovementWidth,
  OrderKind,
  OwnerMode,
  PhaseKind,
  PowerKind,
  SeasonKind,
  UnitKind,
  WireBit,
  WireError,
  WireHeader as PayloadKind,
  WireLimit,
  WireSize,
} from './wire'

const phases: readonly Phase[] = PHASE_IDS
const crc32 = WireChecksum.calculate

const stable = CanonicalValue.normalize.bind(CanonicalValue)
const equal = CanonicalValue.equal.bind(CanonicalValue)
class BoardCodec {
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

/** Compact builds and removals share a board-derived dictionary. */
class BuildOrdersCodec {
  constructor(private readonly map: MapDefinition) {}

  private choice(stream: Bits, values: string[]): string
  private choice(stream: Bits, values: string[], value: string): void
  private choice(stream: Bits, values: string[], value?: string): string | void {
    const schema = choice([...new Set(values)].sort())
    if (value === undefined) return schema.read(stream, undefined)
    schema.write(stream, value, undefined)
  }

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
    for (const order of orders) this.choice(stream, choices, JSON.stringify(stable(order)))
  }

  decode(stream: Bits, board: BoardState): AnyOrder[] {
    const choices = this.buildChoices(board)
    const count = bounded(stream.integer(), WireLimit.ListItems)
    return Array.from({ length: count }, () => JSON.parse(this.choice(stream, choices)) as AnyOrder)
  }
}

class OrderCodec {
  readonly boards: BoardCodec

  constructor(readonly map: MapDefinition) {
    this.boards = new BoardCodec(map)
    this.convoyed = new ConvoyedArmiesCodec(map)
    this.builds = new BuildOrdersCodec(map)
  }

  private readonly builds: BuildOrdersCodec
  private readonly move = new MoveOrderCodec()
  private readonly retreat = new RetreatOrderCodec()
  private readonly support = new SupportOrderCodec()
  private readonly convoy = new ConvoyOrderCodec()
  private readonly convoyed: ConvoyedArmiesCodec

  roster(board: BoardState): Unit[] {
    return sortUnits(board.phase === PhaseKind.Retreat ? board.dislodged.map((entry) => entry.unit) : board.units)
  }
  sourceIndex(roster: Unit[], order: WireOrder): number {
    return roster.findIndex((unit) => this.matchesSource(unit, order))
  }

  private matchesSource(unit: Unit, order: WireOrder): boolean {
    if (unit.nation !== order.nation) return false
    if (unit.territory !== order.source) return false
    return unit.coast === order.sourceCoast
  }
  source(stream: Bits, roster: Unit[]): WireSource
  source(stream: Bits, roster: Unit[], order: WireOrder): void
  source(stream: Bits, roster: Unit[], order?: WireOrder): WireSource | void {
    if (order) return this.writeSource(stream, roster, order)
    return this.readSource(stream, roster)
  }

  private writeSource(stream: Bits, roster: Unit[], order: WireOrder): void {
    const width = Math.ceil(Math.log2(Math.max(WireBit.One, roster.length)))
    const index = this.sourceIndex(roster, order)
    stream.put(index >= WireBit.Zero ? WireBit.One : WireBit.Zero, WireBit.One)
    if (index >= WireBit.Zero) {
      stream.put(index, width)
      return
    }
    countryCodec.write(stream, order.nation, this.boards)
    provinceCodec.write(stream, order.source, this.boards)
    coastCodec.write(stream, order.sourceCoast, this.boards)
  }

  private readSource(stream: Bits, roster: Unit[]): WireSource {
    const width = Math.ceil(Math.log2(Math.max(WireBit.One, roster.length)))
    if (stream.get(WireBit.One)) return this.readIndexedSource(stream, roster, width)
    const nation = countryCodec.read(stream, this.boards)
    const source = provinceCodec.read(stream, this.boards)
    const coast = coastCodec.read(stream, this.boards)
    return { nation, source, ...(coast ? { sourceCoast: coast } : {}) }
  }

  private readIndexedSource(stream: Bits, roster: Unit[], width: number): WireSource {
    const unit = roster[stream.get(width)]
    assert(unit)
    return { nation: unit.nation, source: unit.territory, ...(unit.coast ? { sourceCoast: unit.coast } : {}) }
  }

  action(stream: Bits, phase: Phase): Pick<WireOrder, 'type'> & Partial<WireOrder>
  action(stream: Bits, phase: Phase, order: WireOrder): void
  action(stream: Bits, phase: Phase, order?: WireOrder): (Pick<WireOrder, 'type'> & Partial<WireOrder>) | void {
    if (order) return this.writeAction(stream, phase, order)
    return this.readAction(stream, phase)
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
    if (AUX_ACTIONS.includes(order.type)) optionalPlace.write(stream, order.aux, this.boards)
    if (TARGET_ACTIONS.includes(order.type)) optionalPlace.write(stream, order.target, this.boards)
  }

  private writeActionOptions(stream: Bits, order: WireOrder): void {
    if (COAST_ACTIONS.includes(order.type)) coastCodec.write(stream, order.targetCoast, this.boards)
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
    if (AUX_ACTIONS.includes(order.type)) order.aux = optionalPlace.read(stream, this.boards)
    if (TARGET_ACTIONS.includes(order.type)) order.target = optionalPlace.read(stream, this.boards)
  }

  private readActionOptions(stream: Bits, order: WireOrder | (Pick<WireOrder, 'type'> & Partial<WireOrder>)): void {
    if (COAST_ACTIONS.includes(order.type)) order.targetCoast = coastCodec.read(stream, this.boards)
    if (order.type === OrderKind.Move && stream.get(WireBit.One)) order.viaConvoy = true
    if (order.type !== OrderKind.Build) return
    const unitType = BUILD_TYPES[stream.get(WireSize.Mode)]
    if (unitType) order.unitType = unitType
  }

  genericOrders(stream: Bits, board: BoardState): AnyOrder[]
  genericOrders(stream: Bits, board: BoardState, orders: WireOrder[]): string
  genericOrders(stream: Bits, board: BoardState, orders?: WireOrder[]): AnyOrder[] | string {
    if (orders) return this.writeGenericOrders(stream, board, orders)
    return this.readGenericOrders(stream, board)
  }

  private writeGenericOrders(stream: Bits, board: BoardState, orders: WireOrder[]): string {
    const roster = this.roster(board)
    const sparse = this.sparseOrders(board.phase, roster, orders)
    const indexes = orders.map((order) => this.sourceIndex(roster, order))
    const dense = this.orderedIndexes(indexes) ? this.denseOrders(board, roster, orders, indexes) : undefined
    const useDense = Boolean(dense && dense.data.length < sparse.data.length)
    const selected = useDense && dense ? dense : sparse
    stream.data.push(...selected.data)
    return useDense ? ListMode.Dense : ListMode.Sparse
  }

  private sparseOrders(phase: Phase, roster: Unit[], orders: WireOrder[]): Bits {
    const stream = new Bits()
    stream.put(WireBit.Zero, WireBit.One)
    stream.integer(orders.length)
    for (const order of orders) {
      this.source(stream, roster, order)
      this.action(stream, phase, order)
    }
    return stream
  }

  private orderedIndexes(indexes: number[]): boolean {
    return indexes.every(
      (value, index) => value >= WireBit.Zero && (index === WireBit.Zero || value > indexes[index - WireBit.One]),
    )
  }

  private denseOrders(board: BoardState, roster: Unit[], orders: WireOrder[], indexes: number[]): Bits {
    const stream = new Bits()
    stream.put(WireBit.One, WireBit.One)
    for (let index = WireBit.Zero; index < roster.length; index++) {
      const position = indexes.indexOf(index)
      stream.put(position >= WireBit.Zero ? WireBit.One : WireBit.Zero, WireBit.One)
      if (position >= WireBit.Zero) this.action(stream, board.phase, orders[position])
    }
    return stream
  }

  private readGenericOrders(stream: Bits, board: BoardState): AnyOrder[] {
    const roster = this.roster(board)
    if (stream.get(WireBit.One)) return this.readDenseOrders(stream, board, roster)
    const count = bounded(stream.integer(), WireLimit.ListItems)
    return Array.from({ length: count }, () => this.readSparseOrder(stream, board.phase, roster))
  }

  private readDenseOrders(stream: Bits, board: BoardState, roster: Unit[]): AnyOrder[] {
    const orders: AnyOrder[] = []
    for (const unit of roster) {
      if (!stream.get(WireBit.One)) continue
      const source = this.unitSource(unit)
      const action = this.action(stream, board.phase)
      orders.push({ ...source, ...action } as AnyOrder)
    }
    return orders
  }

  private readSparseOrder(stream: Bits, phase: Phase, roster: Unit[]): AnyOrder {
    const source = this.source(stream, roster)
    const action = this.action(stream, phase)
    return { ...source, ...action } as AnyOrder
  }

  private unitSource(unit: Unit): WireSource {
    return { nation: unit.nation, source: unit.territory, ...(unit.coast ? { sourceCoast: unit.coast } : {}) }
  }

  choice(stream: Bits, values: string[]): string
  choice(stream: Bits, values: string[], value: string): void
  choice(stream: Bits, values: string[], value?: string): string | void {
    const choices = [...new Set(values)].sort()
    const schema = choice(choices)
    if (value === undefined) return schema.read({ uint: (width) => stream.get(width) }, undefined)
    schema.write({ uint: (amount, width) => stream.put(amount, width) }, value, undefined)
  }

  compactAction(stream: Bits, board: BoardState, unit: Unit, order: undefined, viaSet?: Set<string>): AnyOrder
  compactAction(stream: Bits, board: BoardState, unit: Unit, order: WireOrder, viaSet?: Set<string>): void
  compactAction(stream: Bits, board: BoardState, unit: Unit, order?: WireOrder, viaSet?: Set<string>): AnyOrder | void {
    if (order) return this.writeCompactAction(stream, board, unit, order, viaSet)
    return this.readCompactAction(stream, board, unit, viaSet)
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
    this.retreat.encode(stream, order, { map: this.map, board, unit, fields: this.boards })
  }

  private readCompactAction(stream: Bits, board: BoardState, unit: Unit, viaSet?: Set<string>): AnyOrder {
    if (board.phase === PhaseKind.Movement) return this.readMovement(stream, board, unit, viaSet)
    return this.retreat.decode(stream, { map: this.map, board, unit, fields: this.boards })
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
      this.move.encode(stream, order, { map: this.map, board, unit, fields: this.boards, vias: viaSet })
    const context = { map: this.map, board, unit }
    if (order.type === OrderKind.Support) this.support.encode(stream, order, context)
    if (order.type === OrderKind.Convoy) this.convoy.encode(stream, order, context)
  }

  private readMovement(stream: Bits, board: BoardState, unit: Unit, viaSet?: Set<string>): AnyOrder {
    const source = this.unitSource(unit)
    const type = this.readMovementType(stream)
    if (type === OrderKind.Move)
      return {
        ...source,
        ...this.move.decode(stream, { map: this.map, board, unit, fields: this.boards, vias: viaSet }),
      }
    if (type === OrderKind.Hold) return { ...source, type }
    const codec = type === OrderKind.Support ? this.support : this.convoy
    const order = codec.decode(stream, { map: this.map, board, unit })
    return { ...source, ...order }
  }

  private readMovementType(stream: Bits): OrderKind.Move | OrderKind.Support | OrderKind.Hold | OrderKind.Convoy {
    if (!stream.get(WireBit.One)) return OrderKind.Move
    if (!stream.get(WireBit.One)) return OrderKind.Support
    if (!stream.get(WireBit.One)) return OrderKind.Hold
    return OrderKind.Convoy
  }

  compactOrders(stream: Bits, board: BoardState): AnyOrder[]
  compactOrders(stream: Bits, board: BoardState, orders: WireOrder[]): void
  compactOrders(stream: Bits, board: BoardState, orders?: WireOrder[]): AnyOrder[] | void {
    if (orders) return this.writeCompactOrders(stream, board, orders)
    return this.readCompactOrders(stream, board)
  }

  private writeCompactOrders(stream: Bits, board: BoardState, orders: WireOrder[]): void {
    if (board.phase === PhaseKind.Build) {
      this.builds.encode(stream, board, orders)
      return
    }
    this.writeCompactRoster(stream, board, orders)
  }

  private readCompactOrders(stream: Bits, board: BoardState): AnyOrder[] {
    if (board.phase === PhaseKind.Build) return this.builds.decode(stream, board)
    return this.readCompactRoster(stream, board)
  }

  private writeCompactRoster(stream: Bits, board: BoardState, orders: WireOrder[]): void {
    const roster = this.roster(board)
    const indexes = orders.map((order) => this.sourceIndex(roster, order))
    assert(this.orderedIndexes(indexes))
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
    if (position >= WireBit.Zero) this.compactAction(stream, board, unit, orders[position], vias)
  }

  private readCompactRoster(stream: Bits, board: BoardState): AnyOrder[] {
    const roster = this.roster(board)
    const vias = board.phase === PhaseKind.Movement ? this.convoyed.decode(stream, board) : undefined
    const all = stream.get(WireBit.One)
    const orders: AnyOrder[] = []
    for (const unit of roster) {
      if (all || stream.get(WireBit.One)) orders.push(this.compactAction(stream, board, unit, undefined, vias))
    }
    return orders
  }

  decode(stream: Bits, board: BoardState): AnyOrder[] {
    if (stream.get(WireBit.One)) return this.compactOrders(stream, board)
    return this.genericOrders(stream, board)
  }

  encode(stream: Bits, board: BoardState, orders: WireOrder[]): string {
    const generic = this.genericCandidate(board, orders)
    const compact = this.compactCandidate(board, orders)
    const useCompact = Boolean(compact && compact.data.length < generic.data.length)
    const selected = useCompact && compact ? compact : generic
    stream.data.push(...selected.data)
    return useCompact ? ListMode.Compact : ListMode.Generic
  }

  private genericCandidate(board: BoardState, orders: WireOrder[]): Bits {
    const stream = new Bits()
    stream.put(WireBit.Zero, WireBit.One)
    this.genericOrders(stream, board, orders)
    return stream
  }

  private compactCandidate(board: BoardState, orders: WireOrder[]): Bits | undefined {
    try {
      const stream = new Bits()
      stream.put(WireBit.One, WireBit.One)
      this.compactOrders(stream, board, orders)
      this.checkCompactCandidate(stream, board, orders)
      return stream
    } catch {
      return undefined
    }
  }

  private checkCompactCandidate(stream: Bits, board: BoardState, orders: WireOrder[]): void {
    const reader = new Bits(stream.bytes())
    assertEqual(reader.get(WireBit.One), WireBit.One)
    const restored = this.compactOrders(reader, board)
    assert(equal(restored, orders))
  }
}
/** Envelope used by the raw version 1 encoder and decoder. */
class WireEnvelope {
  static encode(raw: Uint8Array): string {
    if (raw.length > WireLimit.PayloadBytes) throw new Error(WireError.TooLarge)
    const envelope = new Uint8Array(raw.length + WireSize.Header + WireSize.Trailer)
    envelope[WireBit.Zero] = PayloadKind.Raw
    envelope.set(raw, WireSize.Header)
    const checksum = new DataView(envelope.buffer)
    checksum.setUint32(envelope.length - WireSize.Trailer, crc32(raw))
    const binary = Array.from(envelope, (byte) => String.fromCharCode(byte)).join(EMPTY_TEXT)
    return btoa(binary)
      .replace(BASE64_PLUS, Base64Char.Minus)
      .replace(BASE64_SLASH, Base64Char.Underline)
      .replace(BASE64_PADDING, Base64Char.Empty)
  }

  static decode(payload: string): Uint8Array {
    assert(typeof payload === 'string' && payload.length <= WireLimit.PayloadChars && PAYLOAD_PATTERN.test(payload))
    const binary = atob(payload.replace(URL_MINUS, Base64Char.Plus).replace(URL_UNDERLINE, Base64Char.Slash))
    const envelope = Uint8Array.from(binary, (char) => char.charCodeAt(WireBit.Zero))
    assert(
      envelope.length >= WireSize.Minimum &&
        envelope.length <= WireLimit.PayloadBytes + WireSize.Header + WireSize.Trailer &&
        envelope[WireBit.Zero] === PayloadKind.Raw,
    )
    const raw = envelope.subarray(WireSize.Header, -WireSize.Trailer)
    const checksum = new DataView(envelope.buffer)
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

  encode(stream: Bits, frame: Frame, next?: BoardState): void {
    assert(frame.orders.length <= WireLimit.Orders)
    this.format.encode(stream, frame.board, frame.orders)
    stream.put(frame.results ? WireBit.One : WireBit.Zero, WireBit.One)
    if (next) this.writeNext(stream, frame, next)
  }

  private writeNext(stream: Bits, frame: Frame, next: BoardState): void {
    const result = adjudicate(this.format.map, frame.board, frame.orders)
    const checkpoint = !equal(result.newBoardState, next)
    stream.put(checkpoint ? WireBit.One : WireBit.Zero, WireBit.One)
    if (checkpoint) this.format.boards.encode(stream, next)
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

  constructor(private readonly sandbox: SandboxContent) {
    const validMap = sandbox.mapId === MapKind.Classical || sandbox.mapId === MapKind.Variant1900
    assert(validMap)
    this.format = new OrderCodec(maps[sandbox.mapId])
    this.frameCodec = new FrameCodec(this.format)
  }

  encode(): string {
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
      this.frameCodec.encode(this.stream, frames[index], frames[index + WireBit.One]?.board)
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
    this.format = new OrderCodec(maps[header.mapId])
    this.frameCodec = new FrameCodec(this.format)
    this.board = this.format.boards.decode(stream)
  }

  static decode(payload: string): SandboxContent {
    const raw = WireEnvelope.decode(payload)
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

/** Entry point composes the envelope, metadata, frames, boards, orders, and fields. */
class SandboxCodec {
  encode(sandbox: SandboxContent): string {
    return new SandboxWriter(sandbox).encode()
  }

  decode(payload: string): SandboxContent {
    return SandboxReader.decode(payload)
  }
}

const sandboxCodec = new SandboxCodec()
const encodeSandbox = (sandbox: SandboxContent): string => sandboxCodec.encode(sandbox)
const decodeSandbox = (payload: string): SandboxContent => sandboxCodec.decode(payload)

export { decodeSandbox, encodeSandbox, equal }
