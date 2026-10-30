import { expect, it } from 'vitest'
import { classicalMap } from '../maps/classical'
import { convoyBoard, TestPlace } from './fixtures.test-helper'
import { ConvoyOrderCodec, ConvoyedArmiesCodec, type WireOrder } from './order-codecs'
import { OrderKind, PowerKind, UnitKind, WireBit, WireStream } from './wire'

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

it('chooses and decodes both sparse and bitmap convoy lists', () => {
  const board = convoyFixture()
  const codec = new ConvoyedArmiesCodec(classicalMap)
  for (const [orders, mode] of [
    [[], WireBit.One],
    [moves(), WireBit.Zero],
  ] as const) {
    const stream = new WireStream()
    const expected = codec.encode(stream, board, [...orders])
    expect(new WireStream(stream.bytes()).get(WireBit.One)).toBe(mode)
    expect(codec.decode(new WireStream(stream.bytes()), board)).toEqual(expected)
  }
})

it('rejects sparse convoy entries outside the eligible roster', () => {
  const board = convoyFixture()
  const stream = new WireStream()
  stream.put(WireBit.One, WireBit.One)
  stream.integer(WireBit.One)
  stream.integer(board.units.length)
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
