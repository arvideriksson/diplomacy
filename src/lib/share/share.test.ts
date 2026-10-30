import { expect, it } from 'vitest'
import { classicalMap } from '../maps/classical'
import { map1900 } from '../maps/1900'
import { choice, decode, encode, flag, literal, struct } from './bits'
import { decodeSandbox as decodeBytes, encodeSandbox as encodeBytes } from './codec'
import { decodeSandbox, encodeSandbox } from './index'
import type { SandboxContent } from './timeline'
import { fromTimeline, toTimeline } from './timeline'
import {
  coastGame,
  convoyGame,
  DRAFT_MOVE,
  DUPLICATE_HOLD,
  FORK_MOVE,
  game,
  GOLDEN_NAME,
  GOLDEN_PAYLOAD,
  INVALID_MOVE,
  OPEN_HOLD,
  OPEN_MOVE,
  retreatGame,
  TestLimit,
} from './fixtures.test-helper'
import { Base64Char, DEFLATE_FORMAT, MapKind, PhaseKind, WireBit, WireHeader, WireSize } from './wire'

const FIRST_INDEX = 0
const LAST_INDEX = 1
const BAD_PAYLOAD = 'not a payload!'
const SAMPLE_ZERO = 'A'
const SAMPLE_ONE = 'B'
const BASE64_PLUS = /\+/g
const BASE64_SLASH = /\//g
const BASE64_PADDING = /=+$/
const URL_MINUS = /-/g
const URL_UNDERLINE = /_/g

async function expectRoundTrip(sandbox: SandboxContent): Promise<void> {
  const payload = await encodeSandbox(sandbox)
  const restored = await decodeSandbox(payload)
  expect(restored).toEqual(sandbox)
}

function checkChoiceCount(count: number): void {
  const values = Array.from({ length: count }, (_entry, index) => index)
  const schema = choice(values)
  for (const value of values) {
    const encoded = encode(schema, value, undefined)
    const restored = decode(schema, encoded.bytes, undefined)
    expect(restored).toBe(value)
  }
}

function checkpointGame(): SandboxContent {
  const sandbox = game(classicalMap, [[FORK_MOVE]])
  sandbox.frames[FIRST_INDEX].orders = []
  sandbox.frames[FIRST_INDEX].results = undefined
  sandbox.cursor = FIRST_INDEX
  return sandbox
}

function payloadBytes(payload: string): Uint8Array {
  const normal = payload.replace(URL_MINUS, Base64Char.Plus).replace(URL_UNDERLINE, Base64Char.Slash)
  const binary = atob(normal)
  return Uint8Array.from(binary, (char) => char.charCodeAt(FIRST_INDEX))
}

function base64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join(Base64Char.Empty)
  return btoa(binary)
    .replace(BASE64_PLUS, Base64Char.Minus)
    .replace(BASE64_SLASH, Base64Char.Underline)
    .replace(BASE64_PADDING, Base64Char.Empty)
}

async function oversizedPayload(): Promise<string> {
  const bytes = new Uint8Array(TestLimit.OverflowBytes)
  const source = new Blob([bytes]).stream()
  const stream = source.pipeThrough(new CompressionStream(DEFLATE_FORMAT))
  const buffer = await new Response(stream).arrayBuffer()
  const body = new Uint8Array(buffer)
  const size = body.length + WireSize.Header + WireSize.Trailer
  const envelope = new Uint8Array(size)
  envelope[FIRST_INDEX] = WireHeader.Deflate
  envelope.set(body, WireSize.Header)
  return base64Url(envelope)
}

it('round trips bounded choices and rejects invalid input', () => {
  for (let count = WireBit.One; count <= TestLimit.Dictionary; count++) checkChoiceCount(count)
  const schema = choice([WireBit.Zero, WireBit.One])
  expect(() => decode(schema, new Uint8Array(), undefined)).toThrow()
  expect(() => decode(schema, Uint8Array.of(WireBit.One), undefined)).toThrow()
})

it('round trips typed fields and validates literal values', () => {
  const schema = struct<void>().field('active', flag).field('kind', literal(SAMPLE_ZERO))
  const value = { active: true, kind: SAMPLE_ZERO }
  const encoded = encode(schema, value, undefined)
  expect(encoded.bitLength).toBe(WireBit.One)
  expect(decode(schema, encoded.bytes, undefined)).toEqual(value)
  const invalid = { active: true, kind: SAMPLE_ONE }
  expect(() => encode(schema, invalid, undefined)).toThrow()
})

it('selects a field dictionary using earlier decoded values', () => {
  const schema = struct<void>()
    .field('active', flag)
    .field('kind', (_context, previous) => choice(previous.active ? [SAMPLE_ONE] : [SAMPLE_ZERO]))
  const value = { active: true, kind: SAMPLE_ONE }
  const encoded = encode(schema, value, undefined)
  expect(decode(schema, encoded.bytes, undefined)).toEqual(value)
  const invalid = { active: false, kind: SAMPLE_ONE }
  expect(() => encode(schema, invalid, undefined)).toThrow()
})

it('preserves a retained future after editing an earlier phase', () => {
  const sandbox = checkpointGame()
  const timeline = toTimeline(sandbox)
  const next = sandbox.frames[LAST_INDEX].board
  expect(timeline.entries[FIRST_INDEX].checkpoint).toEqual(next)
  expect(fromTimeline(timeline)).toEqual(sandbox)
  expect(() => fromTimeline({ ...timeline, cursor: TestLimit.BadCursor })).toThrow()
})

it('keeps the version 1 opening payload stable', async () => {
  const sandbox = game()
  sandbox.name = GOLDEN_NAME
  sandbox.mapId = MapKind.Classical
  const payload = await encodeSandbox(sandbox)
  expect(payload).toBe(GOLDEN_PAYLOAD)
  const restored = await decodeSandbox(GOLDEN_PAYLOAD)
  expect(restored).toEqual(sandbox)
})

it('decodes an envelope that is a view into a larger byte buffer', () => {
  const sandbox = game()
  const bytes = encodeBytes(sandbox, toTimeline(sandbox))
  const padded = new Uint8Array(bytes.length + 2)
  padded.set(bytes, 1)
  expect(decodeBytes(padded.subarray(1, -1))).toEqual(sandbox)
})

it('round trips both map openings and a resolved history with draft orders', async () => {
  const games = [game(), game(map1900), game(classicalMap, [[OPEN_MOVE], [OPEN_HOLD]])]
  for (const sandbox of games) {
    const index = sandbox.frames.length - LAST_INDEX
    sandbox.frames[index].orders = [DRAFT_MOVE]
    await expectRoundTrip(sandbox)
  }
})

it('preserves edited past frames with a checkpoint', async () => {
  const sandbox = checkpointGame()
  await expectRoundTrip(sandbox)
})

it('rejects results that no longer match the recorded orders', async () => {
  const sandbox = game(classicalMap, [[OPEN_MOVE]])
  sandbox.frames[FIRST_INDEX].results = []
  await expect(encodeSandbox(sandbox)).rejects.toThrow('Stored resolution results do not match this engine')
})

it('replays supported attacks, retreats and convoys', async () => {
  const retreat = retreatGame()
  const convoy = convoyGame()
  expect(retreat.frames[LAST_INDEX].board.phase).toBe(PhaseKind.Retreat)
  await expectRoundTrip(retreat)
  await expectRoundTrip(convoy)
})

it('preserves builds and western coasts on 1900', async () => {
  const sandbox = coastGame()
  await expectRoundTrip(sandbox)
})

it('rejects corrupt, truncated and oversized links', async () => {
  const payload = await encodeSandbox(game())
  const prefix = payload[FIRST_INDEX] === SAMPLE_ZERO ? SAMPLE_ONE : SAMPLE_ZERO
  const changed = prefix + payload.slice(LAST_INDEX)
  const trimmed = payload.slice(FIRST_INDEX, -TestLimit.BadCursor)
  const oversized = SAMPLE_ZERO.repeat(TestLimit.TooManyChars)
  const invalid = [changed, trimmed, BAD_PAYLOAD, oversized]
  for (const entry of invalid) await expect(decodeSandbox(entry)).rejects.toThrow()
})

it('compresses and reconstructs a longer history', async () => {
  const rounds = Array.from({ length: TestLimit.LongGame }, () => [])
  const sandbox = game(classicalMap, rounds)
  const payload = await encodeSandbox(sandbox)
  const header = payloadBytes(payload)[FIRST_INDEX]
  expect(header).toBe(WireHeader.Deflate)
  const restored = await decodeSandbox(payload)
  expect(restored).toEqual(sandbox)
})

it('rejects a compressed body that expands beyond the limit', async () => {
  const payload = await oversizedPayload()
  await expect(decodeSandbox(payload)).rejects.toThrow()
})

it('retains duplicate and illegal orders without inventing results', async () => {
  const sandbox = game()
  sandbox.frames[FIRST_INDEX].orders = [INVALID_MOVE, DUPLICATE_HOLD]
  await expectRoundTrip(sandbox)
})
