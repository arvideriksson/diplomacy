import { moveTargets, supportAux, supportTargets, convoyAux, convoyTargets, convoyReach } from '../orders/options'
import { buildSituation, retreatTargets } from '../orders/adjustments'
import { adjudicate, initialBoard } from '../adjudicator'
import { sortUnits } from '../adjudicator/state'
import { maps } from '../maps'
import { choice } from './bits'
import type { MapDefinition } from '../mapDefinition'
import type { Unit } from '../types'
import type { AdjudicationResult, AnyOrder, BoardState, Phase } from '../adjudicator'
import type { SandboxContent } from './timeline'
import { CanonicalValue } from './canonical'

type WireOrder = {
  type: AnyOrder['type']
  nation: string
  source: string
  sourceCoast?: string
  target?: string
  targetCoast?: string
  aux?: string
  viaConvoy?: boolean
  unitType?: Unit['type']
}
type AssistanceKind = `${OrderKind.Support}` | `${OrderKind.Convoy}`
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
  COAST_IDS,
  PHASE_IDS,
  POWER_IDS,
  RULES_ID,
  requireEqual as assertEqual,
  requireWire as assert,
  WireChecksum,
  WireStream as Bits,
  CoastKind,
  ListMode,
  MapKind,
  MovementCode,
  MovementWidth,
  OrderKind,
  OwnerMode,
  PhaseKind,
  PowerKind,
  PowerCode,
  SeasonKind,
  UnitKind,
  WireBit,
  WireError,
  WireHeader as PayloadKind,
  WireLimit,
  WireSize,
} from './wire'

const nations: readonly string[] = POWER_IDS
const coasts: readonly (string | undefined)[] = COAST_IDS
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
  province(stream: Bits): string
  province(stream: Bits, province: string): void
  province(stream: Bits, province?: string): string | void {
    if (province !== undefined) return this.writeProvince(stream, province)
    return this.readProvince(stream)
  }

  private writeProvince(stream: Bits, province: string): void {
    const index = this.provinces.indexOf(province)
    stream.put(index, this.provinceBits)
  }

  private readProvince(stream: Bits): string {
    const index = stream.get(this.provinceBits)
    const province = this.provinces[index]
    assert(province)
    return province
  }

  optionalProvince(stream: Bits, province?: string, read = false): string | undefined {
    if (read) return this.readOptionalProvince(stream)
    this.writeOptionalProvince(stream, province)
  }

  private readOptionalProvince(stream: Bits): string | undefined {
    if (stream.get(WireBit.One)) return this.province(stream)
    return undefined
  }

  private writeOptionalProvince(stream: Bits, province?: string): void {
    const present = province ? WireBit.One : WireBit.Zero
    stream.put(present, WireBit.One)
    if (province) this.province(stream, province)
  }

  country(stream: Bits): string
  country(stream: Bits, nation: string): void
  country(stream: Bits, nation?: string): string | void {
    if (nation !== undefined) return this.writeCountry(stream, nation)
    return this.readCountry(stream)
  }

  private writeCountry(stream: Bits, nation: string): void {
    const power = nation === PowerKind.Britain ? PowerKind.England : nation
    const index = power === PowerKind.Neutral ? PowerCode.Neutral : nations.indexOf(power)
    stream.put(index, WireSize.Power)
  }

  private readCountry(stream: Bits): string {
    const index = stream.get(WireSize.Power)
    const nation = nations[index] ?? PowerKind.Neutral
    const british = this.map.id === MapKind.Variant1900 && nation === PowerKind.England
    return british ? PowerKind.Britain : nation
  }

  coast(stream: Bits, coast?: string, read = false): string | undefined {
    const choices = this.coastChoices()
    const width = Math.ceil(Math.log2(choices.length))
    if (read) return this.readCoast(stream, choices, width)
    stream.put(choices.indexOf(coast), width)
  }

  private coastChoices(): Array<string | undefined> {
    if (this.map.id === MapKind.Variant1900) return [...coasts, CoastKind.West]
    return [...coasts]
  }

  private readCoast(stream: Bits, choices: Array<string | undefined>, width: number): string | undefined {
    const index = stream.get(width)
    assert(index < choices.length)
    return choices[index]
  }

  unit(stream: Bits): Unit
  unit(stream: Bits, unit: Unit): void
  unit(stream: Bits, unit?: Unit): Unit | void {
    if (unit) return this.writeUnit(stream, unit)
    return this.readUnit(stream)
  }

  private writeUnit(stream: Bits, unit: Unit): void {
    this.country(stream, unit.nation)
    const type = unit.type === UnitKind.Fleet ? WireBit.One : WireBit.Zero
    stream.put(type, WireBit.One)
    this.province(stream, unit.territory)
    if (unit.type === UnitKind.Fleet) this.coast(stream, unit.coast)
  }

  private readUnit(stream: Bits): Unit {
    const nation = this.country(stream)
    const type = stream.get(WireBit.One) ? UnitKind.Fleet : UnitKind.Army
    const territory = this.province(stream)
    const coast = type === UnitKind.Fleet ? this.coast(stream, undefined, true) : undefined
    return { nation, type, territory, ...(coast ? { coast } : {}) }
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
    for (const unit of units) this.unit(stream, unit)
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
    for (const unit of added) this.unit(stream, unit)
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
    return Array.from({ length: count }, () => this.unit(stream))
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
    for (const center of this.centers) this.country(stream, owners[center] ?? PowerKind.Neutral)
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
    this.country(stream, owner)
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
      const owner = this.country(stream)
      if (owner !== PowerKind.Neutral) owners[center] = owner
    }
  }

  private readChangedOwners(stream: Bits, owners: Record<string, string>): void {
    const count = stream.integer()
    for (let index = WireBit.Zero; index < count; index++) this.readOwnerChange(stream, owners)
  }

  private readOwnerChange(stream: Bits, owners: Record<string, string>): void {
    const center = this.centers[stream.get(this.centerBits)]
    const owner = this.country(stream)
    assert(center)
    if (owner === PowerKind.Neutral) delete owners[center]
    else owners[center] = owner
  }

  board(stream: Bits): BoardState
  board(stream: Bits, board: BoardState, force?: boolean): void
  board(stream: Bits, board?: BoardState, force = false): BoardState | void {
    if (board) return this.writeBoard(stream, board, force)
    return this.readBoard(stream)
  }

  private writeBoard(stream: Bits, board: BoardState, force: boolean): void {
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
      this.unit(stream, entry.unit)
      this.optionalProvince(stream, entry.attackedFrom)
    }
  }

  private writeContested(stream: Bits, regions: string[]): void {
    stream.integer(regions.length)
    for (const region of [...regions].sort()) this.province(stream, region)
  }

  private readBoard(stream: Bits): BoardState {
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
    const unit = this.unit(stream)
    const attackedFrom = this.optionalProvince(stream, undefined, true) ?? EMPTY_TEXT
    return { unit, attackedFrom }
  }

  private readContested(stream: Bits): string[] {
    const count = bounded(stream.integer(), WireLimit.ListItems)
    return Array.from({ length: count }, () => this.province(stream))
  }

  boardChecksum(board: BoardState): number {
    const stream = new Bits()
    this.board(stream, board, true)
    return crc32(stream.bytes())
  }
}

class OrderCodec extends BoardCodec {
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
    this.country(stream, order.nation)
    this.province(stream, order.source)
    this.coast(stream, order.sourceCoast)
  }

  private readSource(stream: Bits, roster: Unit[]): WireSource {
    const width = Math.ceil(Math.log2(Math.max(WireBit.One, roster.length)))
    if (stream.get(WireBit.One)) return this.readIndexedSource(stream, roster, width)
    const nation = this.country(stream)
    const source = this.province(stream)
    const coast = this.coast(stream, undefined, true)
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
    if (AUX_ACTIONS.includes(order.type)) this.optionalProvince(stream, order.aux)
    if (TARGET_ACTIONS.includes(order.type)) this.optionalProvince(stream, order.target)
  }

  private writeActionOptions(stream: Bits, order: WireOrder): void {
    if (COAST_ACTIONS.includes(order.type)) this.coast(stream, order.targetCoast)
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
    if (AUX_ACTIONS.includes(order.type)) order.aux = this.optionalProvince(stream, undefined, true)
    if (TARGET_ACTIONS.includes(order.type)) order.target = this.optionalProvince(stream, undefined, true)
  }

  private readActionOptions(stream: Bits, order: WireOrder | (Pick<WireOrder, 'type'> & Partial<WireOrder>)): void {
    if (COAST_ACTIONS.includes(order.type)) order.targetCoast = this.coast(stream, undefined, true)
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
    this.writeRetreat(stream, board, unit, order)
  }

  private readCompactAction(stream: Bits, board: BoardState, unit: Unit, viaSet?: Set<string>): AnyOrder {
    if (board.phase === PhaseKind.Movement) return this.readMovement(stream, board, unit, viaSet)
    return this.readRetreat(stream, board, unit)
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
    if (order.type === OrderKind.Move) this.writeMove(stream, board, unit, order, viaSet)
    if (order.type === OrderKind.Support || order.type === OrderKind.Convoy)
      this.writeAssistance(stream, board, unit, order)
  }

  private readMovement(stream: Bits, board: BoardState, unit: Unit, viaSet?: Set<string>): AnyOrder {
    const source = this.unitSource(unit)
    const type = this.readMovementType(stream)
    if (type === OrderKind.Move) return { ...source, ...this.readMove(stream, board, unit, viaSet) }
    if (type === OrderKind.Hold) return { ...source, type }
    const order = this.readAssistance(stream, board, unit, type)
    return { ...source, ...order }
  }

  private readMovementType(stream: Bits): OrderKind.Move | OrderKind.Support | OrderKind.Hold | OrderKind.Convoy {
    if (!stream.get(WireBit.One)) return OrderKind.Move
    if (!stream.get(WireBit.One)) return OrderKind.Support
    if (!stream.get(WireBit.One)) return OrderKind.Hold
    return OrderKind.Convoy
  }

  private moveTargets(board: BoardState, unit: Unit, via: boolean): string[] {
    if (via) return convoyReach(this.map, unit.territory, board.units)
    return moveTargets(this.map, unit).map((target) => target.province)
  }

  private writeMove(stream: Bits, board: BoardState, unit: Unit, order: WireOrder, viaSet?: Set<string>): void {
    assert(viaSet)
    assert(order.target)
    const via = viaSet.has(unit.territory)
    const targets = this.moveTargets(board, unit, via)
    this.choice(stream, targets, order.target)
    this.writeTargetCoast(stream, unit, order.target, order.targetCoast)
  }

  private readMove(stream: Bits, board: BoardState, unit: Unit, viaSet?: Set<string>): WireOrder {
    assert(viaSet)
    const via = viaSet.has(unit.territory)
    const targets = this.moveTargets(board, unit, via)
    const target = this.choice(stream, targets)
    const coast = this.readTargetCoast(stream, unit, target)
    return {
      ...this.unitSource(unit),
      type: OrderKind.Move,
      target,
      ...(via ? { viaConvoy: true } : {}),
      ...(coast ? { targetCoast: coast } : {}),
    }
  }

  private assistanceSources(board: BoardState, unit: Unit, type: AssistanceKind): string[] {
    if (type === OrderKind.Support) return supportAux(this.map, unit, board.units)
    return convoyAux(this.map, unit, board.units)
  }

  private assistanceTargets(board: BoardState, unit: Unit, source: string, type: AssistanceKind): string[] {
    const targetUnit = board.units.find((other) => other.territory === source)
    assert(targetUnit)
    if (type === OrderKind.Support) return supportTargets(this.map, unit, targetUnit, board.units)
    return convoyTargets(this.map, unit, targetUnit, board.units)
  }

  private writeAssistance(stream: Bits, board: BoardState, unit: Unit, order: WireOrder): void {
    assert(order.type === OrderKind.Support || order.type === OrderKind.Convoy)
    assert(order.aux && order.target)
    const sources = this.assistanceSources(board, unit, order.type)
    this.choice(stream, sources, order.aux)
    const targets = this.assistanceTargets(board, unit, order.aux, order.type)
    this.choice(stream, targets, order.target)
  }

  private readAssistance(stream: Bits, board: BoardState, unit: Unit, type: AssistanceKind): WireOrder {
    const sources = this.assistanceSources(board, unit, type)
    const aux = this.choice(stream, sources)
    const targets = this.assistanceTargets(board, unit, aux, type)
    const target = this.choice(stream, targets)
    return { ...this.unitSource(unit), type, aux, target }
  }

  private writeRetreat(stream: Bits, board: BoardState, unit: Unit, order: WireOrder): void {
    assert(board.phase === PhaseKind.Retreat)
    assert(order.type === OrderKind.Retreat || order.type === OrderKind.Disband)
    stream.put(order.type === OrderKind.Retreat ? WireBit.One : WireBit.Zero, WireBit.One)
    if (order.type === OrderKind.Disband) return
    assert(order.target)
    const targets = this.retreatTargets(board, unit)
    this.choice(stream, targets, order.target)
    this.writeTargetCoast(stream, unit, order.target, order.targetCoast)
  }

  private readRetreat(stream: Bits, board: BoardState, unit: Unit): AnyOrder {
    assert(board.phase === PhaseKind.Retreat)
    const source = this.unitSource(unit)
    if (!stream.get(WireBit.One)) return { ...source, type: OrderKind.Disband }
    const targets = this.retreatTargets(board, unit)
    const target = this.choice(stream, targets)
    const coast = this.readTargetCoast(stream, unit, target)
    return { ...source, type: OrderKind.Retreat, target, ...(coast ? { targetCoast: coast } : {}) }
  }

  private retreatTargets(board: BoardState, unit: Unit): string[] {
    const entry = board.dislodged.find((item) => item.unit.territory === unit.territory)
    assert(entry)
    const targets = retreatTargets(this.map, unit, entry.attackedFrom, board.units, board.contested)
    return targets.map((target) => target.province)
  }

  private writeTargetCoast(stream: Bits, unit: Unit, target: string, coast?: string): void {
    if (unit.type !== UnitKind.Fleet) return
    if (!this.map.territories[target].coasts) return
    this.coast(stream, coast)
  }

  private readTargetCoast(stream: Bits, unit: Unit, target: string): string | undefined {
    if (unit.type !== UnitKind.Fleet) return undefined
    if (!this.map.territories[target].coasts) return undefined
    return this.coast(stream, undefined, true)
  }

  convoyList(stream: Bits, board: BoardState, orders?: WireOrder[]): Set<string> {
    const roster = this.roster(board)
    const eligible = roster.filter((unit) => this.canConvoy(board, unit))
    if (orders) return this.writeConvoyList(stream, eligible, orders)
    return this.readConvoyList(stream, eligible)
  }

  private canConvoy(board: BoardState, unit: Unit): boolean {
    if (unit.type !== UnitKind.Army) return false
    const targets = convoyReach(this.map, unit.territory, board.units)
    return targets.length > WireBit.Zero
  }

  private writeConvoyList(stream: Bits, eligible: Unit[], orders: WireOrder[]): Set<string> {
    const indexes = this.convoyIndexes(eligible, orders)
    const sparse = this.sparseConvoys(indexes)
    const bitmap = this.bitmapConvoys(eligible, indexes)
    const useSparse = sparse.data.length < bitmap.data.length
    const selected = useSparse ? sparse : bitmap
    stream.put(useSparse ? WireBit.One : WireBit.Zero, WireBit.One)
    stream.data.push(...selected.data)
    return new Set(indexes.map((index) => eligible[index].territory))
  }

  private convoyIndexes(eligible: Unit[], orders: WireOrder[]): number[] {
    const convoyed = orders.filter((order) => order.type === OrderKind.Move && order.viaConvoy)
    const indexes = convoyed.map((order) => eligible.findIndex((unit) => unit.territory === order.source))
    indexes.sort((left, right) => left - right)
    assert(indexes.every((index) => index >= WireBit.Zero))
    return indexes
  }

  private sparseConvoys(indexes: number[]): Bits {
    const stream = new Bits()
    stream.integer(indexes.length)
    let previous = WireIndex.Missing
    for (const index of indexes) {
      stream.integer(index - previous - WireBit.One)
      previous = index
    }
    return stream
  }

  private bitmapConvoys(eligible: Unit[], indexes: number[]): Bits {
    const stream = new Bits()
    for (let index = WireBit.Zero; index < eligible.length; index++) {
      stream.put(indexes.includes(index) ? WireBit.One : WireBit.Zero, WireBit.One)
    }
    return stream
  }

  private readConvoyList(stream: Bits, eligible: Unit[]): Set<string> {
    const sparse = stream.get(WireBit.One)
    const indexes = sparse ? this.readSparseConvoys(stream, eligible) : this.readBitmapConvoys(stream, eligible)
    return new Set(indexes.map((index) => eligible[index].territory))
  }

  private readSparseConvoys(stream: Bits, eligible: Unit[]): number[] {
    const count = stream.integer()
    assert(count <= eligible.length)
    const indexes: number[] = []
    let previous = WireIndex.Missing
    for (let index = WireBit.Zero; index < count; index++) {
      previous += WireBit.One + stream.integer()
      assert(previous < eligible.length)
      indexes.push(previous)
    }
    return indexes
  }

  private readBitmapConvoys(stream: Bits, eligible: Unit[]): number[] {
    const indexes: number[] = []
    for (let index = WireBit.Zero; index < eligible.length; index++) {
      if (stream.get(WireBit.One)) indexes.push(index)
    }
    return indexes
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

  compactOrders(stream: Bits, board: BoardState): AnyOrder[]
  compactOrders(stream: Bits, board: BoardState, orders: WireOrder[]): void
  compactOrders(stream: Bits, board: BoardState, orders?: WireOrder[]): AnyOrder[] | void {
    if (orders) return this.writeCompactOrders(stream, board, orders)
    return this.readCompactOrders(stream, board)
  }

  private writeCompactOrders(stream: Bits, board: BoardState, orders: WireOrder[]): void {
    if (board.phase === PhaseKind.Build) {
      this.writeCompactBuilds(stream, board, orders)
      return
    }
    this.writeCompactRoster(stream, board, orders)
  }

  private readCompactOrders(stream: Bits, board: BoardState): AnyOrder[] {
    if (board.phase === PhaseKind.Build) return this.readCompactBuilds(stream, board)
    return this.readCompactRoster(stream, board)
  }

  private writeCompactBuilds(stream: Bits, board: BoardState, orders: WireOrder[]): void {
    const choices = this.buildChoices(board)
    stream.integer(orders.length)
    for (const order of orders) this.choice(stream, choices, JSON.stringify(stable(order)))
  }

  private readCompactBuilds(stream: Bits, board: BoardState): AnyOrder[] {
    const choices = this.buildChoices(board)
    const count = bounded(stream.integer(), WireLimit.ListItems)
    return Array.from({ length: count }, () => JSON.parse(this.choice(stream, choices)) as AnyOrder)
  }

  private writeCompactRoster(stream: Bits, board: BoardState, orders: WireOrder[]): void {
    const roster = this.roster(board)
    const indexes = orders.map((order) => this.sourceIndex(roster, order))
    assert(this.orderedIndexes(indexes))
    const vias = board.phase === PhaseKind.Movement ? this.convoyList(stream, board, orders) : undefined
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
    const vias = board.phase === PhaseKind.Movement ? this.convoyList(stream, board) : undefined
    const all = stream.get(WireBit.One)
    const orders: AnyOrder[] = []
    for (const unit of roster) {
      if (all || stream.get(WireBit.One)) orders.push(this.compactAction(stream, board, unit, undefined, vias))
    }
    return orders
  }

  orders(stream: Bits, board: BoardState): AnyOrder[]
  orders(stream: Bits, board: BoardState, orders: WireOrder[]): string
  orders(stream: Bits, board: BoardState, orders?: WireOrder[]): AnyOrder[] | string {
    if (orders) return this.writeOrders(stream, board, orders)
    if (stream.get(WireBit.One)) return this.compactOrders(stream, board)
    return this.genericOrders(stream, board)
  }

  private writeOrders(stream: Bits, board: BoardState, orders: WireOrder[]): string {
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

/** Write a snapshot and each subsequent frame without changing their stored order. */
class SandboxWriter {
  private readonly stream = new Bits()
  private readonly format: OrderCodec

  constructor(private readonly sandbox: SandboxContent) {
    const validMap = sandbox.mapId === MapKind.Classical || sandbox.mapId === MapKind.Variant1900
    assert(validMap)
    this.format = new OrderCodec(maps[sandbox.mapId])
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
    const sandbox = this.sandbox
    const mapCode = sandbox.mapId === MapKind.Variant1900 ? WireBit.One : WireBit.Zero
    this.stream.put(mapCode, WireBit.One)
    this.stream.put(RULES_ID, WireSize.Checksum)
    this.stream.text(sandbox.name)
    this.stream.integer(sandbox.frames.length)
    this.stream.integer(sandbox.cursor)
    this.format.board(this.stream, sandbox.frames[WireBit.Zero].board)
  }

  private writeFrames(): void {
    const frames = this.sandbox.frames
    for (let index = WireBit.Zero; index < frames.length; index++) this.writeFrame(index)
  }

  private writeFrame(index: number): void {
    const frames = this.sandbox.frames
    const frame = frames[index]
    assert(frame.orders.length <= WireLimit.Orders)
    this.format.orders(this.stream, frame.board, frame.orders)
    this.stream.put(frame.results ? WireBit.One : WireBit.Zero, WireBit.One)
    if (index < frames.length - WireBit.One) this.writeTransition(index)
  }

  private writeTransition(index: number): void {
    const frames = this.sandbox.frames
    const frame = frames[index]
    const result = adjudicate(this.format.map, frame.board, frame.orders)
    const next = frames[index + WireBit.One].board
    const checkpoint = !equal(result.newBoardState, next)
    this.stream.put(checkpoint ? WireBit.One : WireBit.Zero, WireBit.One)
    if (checkpoint) this.format.board(this.stream, next)
  }

  private writeChecksum(): void {
    const frame = this.sandbox.frames.at(WireIndex.Missing)
    assert(frame)
    const checksum = this.format.boardChecksum(frame.board)
    this.stream.put(checksum, WireSize.Checksum)
  }
}

interface FrameHeader {
  mapId: string
  name: string
  count: number
  cursor: number
}

/** Read a version 1 stream and reconstruct frames using the existing adjudicator. */
class SandboxReader {
  private readonly format: OrderCodec
  private readonly frames: SandboxContent['frames'] = []
  private board: BoardState

  constructor(
    private readonly stream: Bits,
    private readonly header: FrameHeader,
  ) {
    this.format = new OrderCodec(maps[header.mapId])
    this.board = this.format.board(stream)
  }

  static decode(payload: string): SandboxContent {
    const raw = WireEnvelope.decode(payload)
    const stream = new Bits(raw)
    const header = SandboxReader.readHeader(stream)
    const reader = new SandboxReader(stream, header)
    return reader.read()
  }

  private static readHeader(stream: Bits): FrameHeader {
    const mapId = stream.get(WireBit.One) ? MapKind.Variant1900 : MapKind.Classical
    assertEqual(stream.get(WireSize.Checksum), RULES_ID)
    const name = stream.text()
    const count = stream.integer()
    const cursor = stream.integer()
    assert(count > WireBit.Zero && count <= WireLimit.Frames && cursor < count && name.length <= WireLimit.StringChars)
    return { mapId, name, count, cursor }
  }

  private read(): SandboxContent {
    for (let index = WireBit.Zero; index < this.header.count; index++) this.readFrame(index)
    this.checkResult()
    const { name, mapId, cursor } = this.header
    return { name, mapId, frames: this.frames, cursor }
  }

  private readFrame(index: number): void {
    const orders = this.format.orders(this.stream, this.board)
    assert(orders.length <= WireLimit.Orders)
    const show = this.stream.get(WireBit.One)
    const hasNext = index < this.header.count - WireBit.One
    const result = show || hasNext ? adjudicate(this.format.map, this.board, orders) : undefined
    this.saveFrame(orders, show, result)
    if (hasNext) this.advance(result)
  }

  private saveFrame(orders: AnyOrder[], show: number, result?: AdjudicationResult): void {
    if (show) assert(result)
    const results = show && result ? { results: result.results } : {}
    this.frames.push({ board: this.board, orders, ...results })
  }

  private advance(result?: AdjudicationResult): void {
    assert(result)
    const checkpoint = this.stream.get(WireBit.One)
    this.board = checkpoint ? this.format.board(this.stream) : result.newBoardState
  }

  private checkResult(): void {
    const actual = this.format.boardChecksum(this.board)
    const expected = this.stream.get(WireSize.Checksum)
    assertEqual(actual, expected)
    assert(this.stream.data.length - this.stream.pos < WireSize.Byte)
    while (this.stream.pos < this.stream.data.length) assertEqual(this.stream.get(WireBit.One), WireBit.Zero)
  }
}

function encodeSandbox(sandbox: SandboxContent): string {
  const writer = new SandboxWriter(sandbox)
  return writer.encode()
}

function decodeSandbox(payload: string): SandboxContent {
  return SandboxReader.decode(payload)
}

export { decodeSandbox, encodeSandbox, equal }
