import { expect, it } from 'vitest'
import { WireBit, WireError, WireSize, WireStream } from './wire'

const THREE_BITS = 3
const FIVE_BITS = 5
const FIRST_VALUE = 5
const SECOND_VALUE = 19
const COMBINED_BYTE = 0xb3
const MAX_UINT32 = 0xffffffff

it('appends an unaligned candidate without adding padding bits', () => {
  const stream = new WireStream()
  const candidate = new WireStream()
  stream.put(FIRST_VALUE, THREE_BITS)
  candidate.put(SECOND_VALUE, FIVE_BITS)
  stream.append(candidate)
  expect(stream.length).toBe(WireSize.Byte)
  expect(stream.bytes()).toEqual(Uint8Array.of(COMBINED_BYTE))
  const reader = new WireStream(stream.bytes())
  expect(reader.get(THREE_BITS)).toBe(FIRST_VALUE)
  expect(reader.get(FIVE_BITS)).toBe(SECOND_VALUE)
  expect(() => reader.get(WireBit.One)).toThrow(WireError.Truncated)
})

it('handles zero-width fields, empty streams and unsigned 32-bit values', () => {
  const empty = new WireStream(new Uint8Array())
  expect(empty.get(WireBit.Zero)).toBe(WireBit.Zero)
  expect(() => empty.get(WireBit.One)).toThrow(WireError.Truncated)
  const stream = new WireStream()
  stream.put(WireBit.Zero, WireBit.Zero)
  stream.append(new WireStream())
  stream.put(MAX_UINT32, WireSize.Checksum)
  const reader = new WireStream(stream.bytes())
  expect(reader.get(WireSize.Checksum)).toBe(MAX_UINT32)
})
