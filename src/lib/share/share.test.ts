import { describe, expect, it } from 'vitest'
import { choice, encode, decode } from './bits'
import { toTimeline, fromTimeline } from './timeline'
import { initialBoard, adjudicate } from '../adjudicator'
import { classicalMap } from '../maps/classical'

describe('sandbox sharing primitives', () => {
  it('round trips bounded choices and rejects invalid input', () => {
    for (let count = 1; count <= 100; count++) {
      const values = Array.from({ length: count }, (_, i) => i)
      for (const value of values) {
        const encoded = encode(choice(values), value, undefined)
        expect(decode(choice(values), encoded.bytes, undefined)).toBe(value)
      }
    }
    expect(() => decode(choice([0, 1]), new Uint8Array(), undefined)).toThrow()
    expect(() => decode(choice([0, 1]), Uint8Array.of(1), undefined)).toThrow()
  })

  it('preserves a retained future after editing an earlier phase', () => {
    const board = initialBoard(classicalMap)
    const order = { type: 'Move' as const, nation: 'germany', source: 'MUN', target: 'TYR' }
    const next = adjudicate(classicalMap, board, [order]).newBoardState
    const sandbox = {
      name: 'Fork',
      mapId: 'classical',
      cursor: 0,
      frames: [
        { board, orders: [] },
        { board: next, orders: [] },
      ],
    }
    const timeline = toTimeline(sandbox)
    expect(timeline.entries[0].checkpoint).toEqual(next)
    expect(fromTimeline(timeline)).toEqual(sandbox)
    expect(() => fromTimeline({ ...timeline, cursor: 5 })).toThrow()
  })
})

import { encodeSandbox, decodeSandbox } from './index'
import { map1900 } from '../maps/1900'
import type { AnyOrder, BoardState } from '../adjudicator'

function game(map = classicalMap, rounds: AnyOrder[][] = []) {
  let board = initialBoard(map)
  const frames = rounds.map((orders) => {
    const before = board
    const result = adjudicate(map, board, orders)
    board = result.newBoardState
    return { board: before, orders, results: result.results }
  })
  return {
    name: 'Shared game',
    mapId: map.id,
    cursor: frames.length,
    frames: [...frames, { board, orders: [], results: undefined }],
  }
}

describe('shared sandbox payload', () => {
  it('keeps the version 1 opening payload stable', async () => {
    const sandbox = {
      name: 'Opening',
      mapId: 'classical',
      cursor: 0,
      frames: [{ board: initialBoard(classicalMap), orders: [] }],
    }
    const payload = 'EAVN5RuIT3BlbmluZ1kSc-3agK2UXms'
    expect(await encodeSandbox(sandbox)).toBe(payload)
    expect(await decodeSandbox(payload)).toEqual(sandbox)
  })

  it('round trips both map openings and a resolved history with draft orders', async () => {
    for (const sandbox of [
      game(),
      game(map1900),
      game(classicalMap, [
        [{ type: 'Move', nation: 'england', source: 'LON', target: 'NTH' }],
        [{ type: 'Hold', nation: 'england', source: 'NTH' }],
      ]),
    ]) {
      sandbox.frames[sandbox.frames.length - 1].orders = [{ type: 'Move', nation: 'france', source: 'PAR' }]
      expect(await decodeSandbox(await encodeSandbox(sandbox))).toEqual(sandbox)
    }
  })

  it('preserves edited past frames with a checkpoint', async () => {
    const sandbox = game(classicalMap, [[{ type: 'Move', nation: 'germany', source: 'MUN', target: 'TYR' }]])
    sandbox.frames[0].orders = []
    sandbox.frames[0].results = undefined
    sandbox.cursor = 0
    expect(await decodeSandbox(await encodeSandbox(sandbox))).toEqual(sandbox)
  })

  it('replays supported attacks, retreats and convoys', async () => {
    const opening = initialBoard(classicalMap)
    const base: BoardState = {
      ...opening,
      units: [
        { nation: 'germany', type: 'army', territory: 'BEL' },
        { nation: 'france', type: 'army', territory: 'BUR' },
        { nation: 'france', type: 'army', territory: 'PIC' },
      ],
      supplyCenters: { BEL: 'germany', PAR: 'france', BRE: 'france', MAR: 'france' },
    }
    const attacks: AnyOrder[] = [
      { type: 'Hold', nation: 'germany', source: 'BEL' },
      { type: 'Move', nation: 'france', source: 'BUR', target: 'BEL' },
      { type: 'Support', nation: 'france', source: 'PIC', aux: 'BUR', target: 'BEL' },
    ]
    const first = adjudicate(classicalMap, base, attacks)
    expect(first.newBoardState.phase).toBe('retreat')
    const retreats: AnyOrder[] = [{ type: 'Retreat', nation: 'germany', source: 'BEL', target: 'HOL' }]
    const second = adjudicate(classicalMap, first.newBoardState, retreats)
    const sandbox = {
      name: 'Retreat',
      mapId: 'classical',
      cursor: 1,
      frames: [
        { board: base, orders: attacks, results: first.results },
        { board: first.newBoardState, orders: retreats, results: second.results },
        { board: second.newBoardState, orders: [] },
      ],
    }
    expect(await decodeSandbox(await encodeSandbox(sandbox))).toEqual(sandbox)
    const convoyBoard: BoardState = {
      ...opening,
      units: [
        { nation: 'france', type: 'army', territory: 'BRE' },
        { nation: 'france', type: 'fleet', territory: 'ENG' },
      ],
      supplyCenters: { BRE: 'france' },
    }
    const convoy: AnyOrder[] = [
      { type: 'Move', nation: 'france', source: 'BRE', target: 'BEL', viaConvoy: true },
      { type: 'Convoy', nation: 'france', source: 'ENG', aux: 'BRE', target: 'BEL' },
    ]
    const resolved = adjudicate(classicalMap, convoyBoard, convoy)
    const convoyGame = {
      name: 'Convoy',
      mapId: 'classical',
      cursor: 1,
      frames: [
        { board: convoyBoard, orders: convoy, results: resolved.results },
        { board: resolved.newBoardState, orders: [] },
      ],
    }
    expect(await decodeSandbox(await encodeSandbox(convoyGame))).toEqual(convoyGame)
  })

  it('preserves builds, removals and western coasts on 1900', async () => {
    const board: BoardState = {
      ...initialBoard(map1900),
      year: 1903,
      season: 'Fall',
      phase: 'build',
      units: [{ nation: 'france', type: 'fleet', territory: 'SPA', coast: 'wc' }],
      supplyCenters: { BRE: 'france', PAR: 'france' },
      dislodged: [],
      contested: [],
    }
    const orders: AnyOrder[] = [{ type: 'Build', nation: 'france', source: 'BRE', unitType: 'fleet' }]
    const next = adjudicate(map1900, board, orders)
    const sandbox = {
      name: '1900 coast',
      mapId: '1900',
      cursor: 1,
      frames: [
        { board, orders, results: next.results },
        { board: next.newBoardState, orders: [] },
      ],
    }
    expect(await decodeSandbox(await encodeSandbox(sandbox))).toEqual(sandbox)
  })

  it('rejects corrupt, truncated and oversized links', async () => {
    const payload = await encodeSandbox(game())
    const changed = (payload[0] === 'A' ? 'B' : 'A') + payload.slice(1)
    for (const invalid of [changed, payload.slice(0, -5), 'not a payload!', 'A'.repeat(44001)]) {
      await expect(decodeSandbox(invalid)).rejects.toThrow()
    }
  })

  it('compresses and reconstructs a longer history', async () => {
    const sandbox = game(
      classicalMap,
      Array.from({ length: 60 }, () => []),
    )
    const payload = await encodeSandbox(sandbox)
    expect(atob(payload.replace(/-/g, '+').replace(/_/g, '/')).charCodeAt(0)).toBe(0x11)
    expect(await decodeSandbox(payload)).toEqual(sandbox)
  })

  it('rejects a compressed body that expands beyond the limit', async () => {
    const body = new Uint8Array(
      await new Response(
        new Blob([new Uint8Array(32769)]).stream().pipeThrough(new CompressionStream('deflate-raw')),
      ).arrayBuffer(),
    )
    const envelope = new Uint8Array(body.length + 5)
    envelope[0] = 0x11
    envelope.set(body, 1)
    const payload = btoa(Array.from(envelope, (value) => String.fromCharCode(value)).join(''))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    await expect(decodeSandbox(payload)).rejects.toThrow()
  })

  it('retains duplicate and illegal orders without inventing results', async () => {
    const sandbox = game()
    sandbox.frames[0].orders = [
      { type: 'Move', nation: 'england', source: 'LON', target: 'MOS' },
      { type: 'Hold', nation: 'england', source: 'LON' },
    ]
    expect(await decodeSandbox(await encodeSandbox(sandbox))).toEqual(sandbox)
  })
})
