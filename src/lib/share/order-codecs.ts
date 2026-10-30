import type { AnyOrder, BoardState } from '../adjudicator'
import { sortUnits } from '../adjudicator/state'
import type { MapDefinition } from '../mapDefinition'
import { convoyAux, convoyReach, convoyTargets, moveTargets, supportAux, supportTargets } from '../orders/options'
import { retreatTargets } from '../orders/adjustments'
import { coastCodec, type FieldContext } from './fields'
import type { Unit } from '../types'
import { sortedChoices, type Codec } from './bits'
import { OrderKind, UnitKind, WireBit, WireIndex, WireStream, requireWire, shortest } from './wire'

/** A location selected from the places available in the current board context. */
const placeChoice: Codec<string, string[]> = {
  encode: (stream, value, places) => sortedChoices(places).encode(stream, value, undefined),
  decode: (stream, places) => sortedChoices(places).decode(stream, undefined),
}

export type WireOrder = {
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

export interface OrderContext {
  map: MapDefinition
  board: BoardState
  unit: Unit
}

/** Encode one support or convoy order using the current board's possible targets. */
export class AssistanceOrderCodec {
  constructor(private readonly type: AssistanceKind) {}

  encode(stream: WireStream, order: WireOrder, context: OrderContext): void {
    requireWire(order.type === this.type && order.aux && order.target)
    placeChoice.encode(stream, order.aux, this.sources(context))
    placeChoice.encode(stream, order.target, this.targets(context, order.aux))
  }

  decode(stream: WireStream, context: OrderContext): WireOrder {
    const aux = placeChoice.decode(stream, this.sources(context))
    const target = placeChoice.decode(stream, this.targets(context, aux))
    const { nation, territory: source, coast } = context.unit
    return { nation, source, ...(coast ? { sourceCoast: coast } : {}), type: this.type, aux, target }
  }

  private sources({ map, board, unit }: OrderContext): string[] {
    if (this.type === OrderKind.Support) return supportAux(map, unit, board.units)
    return convoyAux(map, unit, board.units)
  }

  private targets({ map, board, unit }: OrderContext, source: string): string[] {
    const target = board.units.find((other) => other.territory === source)
    requireWire(target)
    if (this.type === OrderKind.Support) return supportTargets(map, unit, target, board.units)
    return convoyTargets(map, unit, target, board.units)
  }
}

export class ConvoyOrderCodec extends AssistanceOrderCodec {
  constructor() {
    super(OrderKind.Convoy)
  }
}

export class SupportOrderCodec extends AssistanceOrderCodec {
  constructor() {
    super(OrderKind.Support)
  }
}

interface MoveContext extends OrderContext {
  fields: FieldContext
  vias?: Set<string>
}

class TargetCodec {
  protected source(unit: Unit) {
    const { nation, territory: source, coast } = unit
    return { nation, source, ...(coast ? { sourceCoast: coast } : {}) }
  }

  protected writeCoast(stream: WireStream, context: MoveContext, target: string, coast?: string): void {
    if (context.unit.type !== UnitKind.Fleet || !context.map.territories[target].coasts) return
    coastCodec.encode(stream, coast, context.fields)
  }

  protected readCoast(stream: WireStream, context: MoveContext, target: string): string | undefined {
    if (context.unit.type !== UnitKind.Fleet || !context.map.territories[target].coasts) return undefined
    return coastCodec.decode(stream, context.fields)
  }
}

/** Encode a movement order in the context of its unit and possible convoy routes. */
export class MoveOrderCodec extends TargetCodec {
  encode(stream: WireStream, order: WireOrder, context: MoveContext): void {
    requireWire(context.vias && order.target)
    const via = context.vias.has(context.unit.territory)
    placeChoice.encode(stream, order.target, this.targets(context, via))
    this.writeCoast(stream, context, order.target, order.targetCoast)
  }

  decode(stream: WireStream, context: MoveContext): WireOrder {
    requireWire(context.vias)
    const via = context.vias.has(context.unit.territory)
    const target = placeChoice.decode(stream, this.targets(context, via))
    const coast = this.readCoast(stream, context, target)
    return {
      ...this.source(context.unit),
      type: OrderKind.Move,
      target,
      ...(via ? { viaConvoy: true } : {}),
      ...(coast ? { targetCoast: coast } : {}),
    }
  }

  private targets({ map, board, unit }: MoveContext, via: boolean): string[] {
    if (via) return convoyReach(map, unit.territory, board.units)
    return moveTargets(map, unit).map((target) => target.province)
  }
}

/** Encode a retreat or disband for a dislodged unit. */
export class RetreatOrderCodec extends TargetCodec {
  encode(stream: WireStream, order: WireOrder, context: MoveContext): void {
    requireWire(order.type === OrderKind.Retreat || order.type === OrderKind.Disband)
    stream.put(order.type === OrderKind.Retreat ? WireBit.One : WireBit.Zero, WireBit.One)
    if (order.type === OrderKind.Disband) return
    requireWire(order.target)
    placeChoice.encode(stream, order.target, this.targets(context))
    this.writeCoast(stream, context, order.target, order.targetCoast)
  }

  decode(stream: WireStream, context: MoveContext): WireOrder {
    const source = this.source(context.unit)
    if (!stream.get(WireBit.One)) return { ...source, type: OrderKind.Disband }
    const target = placeChoice.decode(stream, this.targets(context))
    const coast = this.readCoast(stream, context, target)
    return { ...source, type: OrderKind.Retreat, target, ...(coast ? { targetCoast: coast } : {}) }
  }

  private targets({ map, board, unit }: MoveContext): string[] {
    const entry = board.dislodged.find((item) => item.unit.territory === unit.territory)
    requireWire(entry)
    return retreatTargets(map, unit, entry.attackedFrom, board.units, board.contested).map((target) => target.province)
  }
}

/** Encode the set of armies using convoy routes in a movement phase. */
export class ConvoyedArmiesCodec {
  constructor(private readonly map: MapDefinition) {}

  encode(stream: WireStream, board: BoardState, orders: WireOrder[]): Set<string> {
    const eligible = this.eligible(board)
    const indexes = this.indexes(eligible, orders)
    const sparse = this.sparse(indexes)
    const bitmap = this.bitmap(eligible, indexes)
    const selected = shortest(bitmap, sparse)
    stream.put(selected === sparse ? WireBit.One : WireBit.Zero, WireBit.One)
    stream.data.push(...selected.data)
    return this.territories(eligible, indexes)
  }

  decode(stream: WireStream, board: BoardState): Set<string> {
    const eligible = this.eligible(board)
    const sparse = stream.get(WireBit.One)
    const indexes = sparse ? this.readSparse(stream, eligible) : this.readBitmap(stream, eligible)
    return this.territories(eligible, indexes)
  }

  private eligible(board: BoardState): Unit[] {
    return sortUnits(board.units).filter((unit) => this.canConvoy(board, unit))
  }

  private canConvoy(board: BoardState, unit: Unit): boolean {
    if (unit.type !== UnitKind.Army) return false
    return convoyReach(this.map, unit.territory, board.units).length > WireBit.Zero
  }

  private indexes(eligible: Unit[], orders: WireOrder[]): number[] {
    const convoyed = orders.filter((order) => order.type === OrderKind.Move && order.viaConvoy)
    const indexes = convoyed.map((order) => eligible.findIndex((unit) => unit.territory === order.source))
    indexes.sort((left, right) => left - right)
    requireWire(indexes.every((index) => index >= WireBit.Zero))
    return indexes
  }

  private territories(eligible: Unit[], indexes: number[]): Set<string> {
    return new Set(indexes.map((index) => eligible[index].territory))
  }

  private sparse(indexes: number[]): WireStream {
    const stream = new WireStream()
    stream.writeInteger(indexes.length)
    let previous = WireIndex.Missing
    for (const index of indexes) {
      stream.writeInteger(index - previous - WireBit.One)
      previous = index
    }
    return stream
  }

  private bitmap(eligible: Unit[], indexes: number[]): WireStream {
    const stream = new WireStream()
    for (let index = WireBit.Zero; index < eligible.length; index++) {
      stream.put(indexes.includes(index) ? WireBit.One : WireBit.Zero, WireBit.One)
    }
    return stream
  }

  private readSparse(stream: WireStream, eligible: Unit[]): number[] {
    const count = stream.readInteger()
    requireWire(count <= eligible.length)
    const indexes: number[] = []
    let previous = WireIndex.Missing
    for (let index = WireBit.Zero; index < count; index++) {
      previous += WireBit.One + stream.readInteger()
      requireWire(previous < eligible.length)
      indexes.push(previous)
    }
    return indexes
  }

  private readBitmap(stream: WireStream, eligible: Unit[]): number[] {
    const indexes: number[] = []
    for (let index = WireBit.Zero; index < eligible.length; index++) {
      if (stream.get(WireBit.One)) indexes.push(index)
    }
    return indexes
  }
}
