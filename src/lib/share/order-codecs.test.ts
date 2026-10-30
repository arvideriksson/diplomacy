import { expect, it } from 'vitest'
import { classicalMap } from '../maps/classical'
import { initialBoard } from '../adjudicator'
import { BoardCodec } from './board-codecs'
import { OrderCodec } from './order-modes'
import { convoyBoard, TestPlace } from './fixtures.test-helper'
import { ConvoyOrderCodec, ConvoyedArmiesCodec, type WireOrder } from './order-codecs'
import { OrderKind, PhaseKind, PowerKind, UnitKind, WireBit, WireStream, shortest, readList, writeList } from './wire'

function convoyFixture() {
  const board = convoyBoard()
  board.units.push({ nation: PowerKind.England, type: UnitKind.Army, territory: TestPlace.London })
  return board
}

function moves(): WireOrder[] {
  return [
    { nation: PowerKind.France, type: OrderKind.Move, source: TestPlace.Brest, viaConvoy: true },
    { nation: PowerKind.England, type: OrderKind.Move, source: TestPlace.London, viaConvoy: true },
  ]
}

it('selects the shorter representation and keeps the first one on ties', () => {
  const first = new WireStream()
  const second = new WireStream()
  first.put(WireBit.One, WireBit.One)
  second.put(WireBit.Zero, WireBit.One)
  expect(shortest(first, second)).toBe(first)
  second.put(WireBit.One, WireBit.One)
  expect(shortest(second, first)).toBe(first)
  expect(shortest(first)).toBe(first)
})

it('chooses and decodes both sparse and bitmap convoy lists', () => {
  const board = convoyFixture()
  const codec = new ConvoyedArmiesCodec(classicalMap)
  for (const [orders, mode] of [
    [[], WireBit.One],
    [moves(), WireBit.Zero],
  ] as const) {
    const stream = new WireStream()
    const expected = codec.encode(stream, board, [...orders])
    expect(stream.data[WireBit.Zero]).toBe(mode)
    expect(codec.decode(new WireStream(stream.bytes()), board)).toEqual(expected)
  }
})

it('rejects sparse convoy entries outside the eligible roster', () => {
  const board = convoyFixture()
  const stream = new WireStream()
  stream.put(WireBit.One, WireBit.One)
  stream.writeInteger(WireBit.One)
  stream.writeInteger(board.units.length)
  const codec = new ConvoyedArmiesCodec(classicalMap)
  expect(() => codec.decode(new WireStream(stream.bytes()), board)).toThrow()
})

it('round trips convoy orders with the fleet and board as context', () => {
  const board = convoyBoard()
  const unit = board.units.find((entry) => entry.territory === TestPlace.EnglishChannel)!
  const context = { map: classicalMap, board, unit }
  const order: WireOrder = {
    nation: PowerKind.France,
    type: OrderKind.Convoy,
    source: TestPlace.EnglishChannel,
    aux: TestPlace.Brest,
    target: TestPlace.Belgium,
  }
  const stream = new WireStream()
  const codec = new ConvoyOrderCodec()
  codec.encode(stream, order, context)
  expect(codec.decode(new WireStream(stream.bytes()), context)).toEqual(order)
})

it('round-trips bounded lists and rejects excessive lengths before reading items', () => {
  const stream = new WireStream()
  writeList(stream, [1, 2, 3], (item) => stream.writeInteger(item), 3)
  const reader = new WireStream(stream.bytes())
  expect(readList(reader, () => reader.readInteger(), 3)).toEqual([1, 2, 3])
  expect(() => writeList(new WireStream(), [1, 2], () => {}, 1)).toThrow()
  const oversized = new WireStream()
  oversized.writeInteger(2)
  const input = new WireStream(oversized.bytes())
  let called = false
  expect(() =>
    readList(
      input,
      () => {
        called = true
      },
      1,
    ),
  ).toThrow()
  expect(called).toBe(false)
})


it('encodes an empty build phase without requiring any build choices', () => {
  const board = initialBoard(classicalMap)
  board.phase = PhaseKind.Build
  const codec = new OrderCodec(new BoardCodec(classicalMap))
  const stream = new WireStream()
  codec.encode(stream, board, [])
  expect(stream.data[0]).toBe(WireBit.One)
  expect(codec.decode(new WireStream(stream.bytes()), board)).toEqual([])
})
