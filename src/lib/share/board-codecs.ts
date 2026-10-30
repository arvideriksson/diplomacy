import { sortUnits } from '../adjudicator/state'
import type { Unit } from '../types'
import type { BoardCodec } from './codec'
import { countryCodec, unitCodec } from './fields'
import { CanonicalValue } from './canonical'
import {
  readList,
  writeList,
  writeShortest,
  WireIndex,
  WireStream as Bits,
  OwnerMode,
  PowerKind,
  WireBit,
  WireSize,
  requireWire as assert,
} from './wire'

const equal = CanonicalValue.equal.bind(CanonicalValue)

/** Encode either complete units or changes from the opening position. */
export class BoardUnitsCodec {
  constructor(private readonly board: BoardCodec) {}

  encode(stream: Bits, units: Unit[], force: boolean): void {
    const ordered = sortUnits(units)
    const complete = this.completeUnits(ordered)
    const changes = this.changedUnits(ordered)
    writeShortest(stream, complete, force ? undefined : changes)
  }

  private completeUnits(units: Unit[]): Bits {
    const stream = new Bits()
    stream.put(WireBit.Zero, WireBit.One)
    writeList(stream, units, (unit) => unitCodec.encode(stream, unit, this.board))
    return stream
  }

  private changedUnits(units: Unit[]): Bits {
    const stream = new Bits()
    const removed = this.removedUnits(units)
    const added = units.filter((unit) => !this.board.opening.units.some((start) => equal(start, unit)))
    stream.put(WireBit.One, WireBit.One)
    const width = Math.ceil(Math.log2(this.board.opening.units.length))
    writeList(stream, removed, (index) => stream.put(index, width))
    writeList(stream, added, (unit) => unitCodec.encode(stream, unit, this.board))
    return stream
  }

  private removedUnits(units: Unit[]): number[] {
    return this.board.opening.units
      .map((unit, index) => (units.some((item) => equal(unit, item)) ? WireIndex.Missing : index))
      .filter((index) => index >= WireBit.Zero)
  }

  decode(stream: Bits): Unit[] {
    if (stream.get(WireBit.One)) return this.readChangedUnits(stream)
    return this.readUnits(stream)
  }

  private readUnits(stream: Bits): Unit[] {
    return readList(stream, () => unitCodec.decode(stream, this.board))
  }

  private readChangedUnits(stream: Bits): Unit[] {
    const width = Math.ceil(Math.log2(this.board.opening.units.length))
    const removed = readList(stream, () => stream.get(width))
    const remaining = this.board.opening.units.filter((_unit, index) => !removed.includes(index))
    const added = this.readUnits(stream)
    return sortUnits([...remaining, ...added])
  }
}

/** Encode center ownership as a complete list or changes from the opening. */
export class BoardOwnersCodec {
  constructor(private readonly board: BoardCodec) {}

  encode(stream: Bits, owners: Record<string, string>, force: boolean): void {
    const complete = this.completeOwners(owners)
    const changes = this.changedOwners(owners)
    writeShortest(stream, complete, force ? undefined : changes)
  }

  private completeOwners(owners: Record<string, string>): Bits {
    const stream = new Bits()
    stream.put(OwnerMode.Complete, WireSize.Mode)
    for (const center of this.board.centers)
      countryCodec.encode(stream, owners[center] ?? PowerKind.Neutral, this.board)
    return stream
  }

  private changedOwners(owners: Record<string, string>): Bits {
    const stream = new Bits()
    const changes = this.board.centers.filter((center) => owners[center] !== this.board.opening.supplyCenters[center])
    stream.put(changes.length ? OwnerMode.Changes : OwnerMode.Opening, WireSize.Mode)
    if (!changes.length) return stream
    stream.writeInteger(changes.length)
    for (const center of changes) this.writeOwnerChange(stream, center, owners)
    return stream
  }

  private writeOwnerChange(stream: Bits, center: string, owners: Record<string, string>): void {
    const index = this.board.centers.indexOf(center)
    const owner = owners[center] ?? PowerKind.Neutral
    stream.put(index, this.board.centerBits)
    countryCodec.encode(stream, owner, this.board)
  }

  decode(stream: Bits): Record<string, string> {
    const mode = stream.get(WireSize.Mode)
    assert(mode !== OwnerMode.Reserved)
    const owners = mode === OwnerMode.Complete ? {} : { ...this.board.opening.supplyCenters }
    if (mode === OwnerMode.Complete) this.readCompleteOwners(stream, owners)
    if (mode === OwnerMode.Changes) this.readChangedOwners(stream, owners)
    return owners
  }

  private readCompleteOwners(stream: Bits, owners: Record<string, string>): void {
    for (const center of this.board.centers) {
      const owner = countryCodec.decode(stream, this.board)
      if (owner !== PowerKind.Neutral) owners[center] = owner
    }
  }

  private readChangedOwners(stream: Bits, owners: Record<string, string>): void {
    const count = stream.readInteger()
    for (let index = WireBit.Zero; index < count; index++) this.readOwnerChange(stream, owners)
  }

  private readOwnerChange(stream: Bits, owners: Record<string, string>): void {
    const center = this.board.centers[stream.get(this.board.centerBits)]
    const owner = countryCodec.decode(stream, this.board)
    assert(center)
    if (owner === PowerKind.Neutral) delete owners[center]
    else owners[center] = owner
  }
}
