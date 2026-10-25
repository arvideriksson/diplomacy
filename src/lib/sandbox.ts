// Local-only sandbox games for trying out the rules. These never touch Supabase:
// state lives in localStorage and the pure engine runs in the browser. Zero backend
// cost. Sandboxes are a non-authoritative dev tool — real games still resolve only
// in the Edge Function.
//
// A sandbox is a navigable chain of phases (`frames`). Each frame holds the board
// going into that phase and the orders entered for it. A `cursor` marks the phase
// being viewed, so you can step back/forward and the orders are preset. Editing a
// past phase's orders forks the timeline (the future is discarded).

import { writable } from 'svelte/store'
import { adjudicate, initialBoard } from './adjudicator'
import type { AdjudicationResult, AnyOrder, BoardState, OrderResult } from './adjudicator'
import { getMap } from './maps'

export interface Frame {
  /** Board state going into this phase. */
  board: BoardState
  /** Orders entered for this phase (preset when revisiting). */
  orders: AnyOrder[]
  /** How those orders resolved, kept while they're unchanged so a revisit shows them. */
  results?: OrderResult[]
}

/** The live game a sandbox was copied from. */
export interface SandboxOrigin {
  gameId: string
  gameName: string
}

export interface Sandbox {
  id: string
  name: string
  mapId: string
  frames: Frame[]
  /** Index of the phase currently being viewed. */
  cursor: number
  createdAt: string
  /** Set when copied from a game: the sandbox lives inside that game's view. */
  origin?: SandboxOrigin
}

const KEY = 'diplomacy:sandboxes'

// Tolerate the previous {board, past[]} shape by converting it to frames.
interface LegacySandbox {
  id: string
  name: string
  mapId: string
  board?: BoardState
  past?: BoardState[]
  frames?: Frame[]
  cursor?: number
  createdAt: string
}

/** The opening phase of a new (or reset) sandbox on a map. */
const freshFrame = (mapId: string): Frame => ({ board: initialBoard(getMap(mapId)), orders: [] })

function migrate(s: LegacySandbox): Sandbox {
  if (s.frames) return s as Sandbox
  const boards = [...(s.past ?? []), s.board].filter(Boolean) as BoardState[]
  const frames: Frame[] = boards.map((board) => ({ board, orders: [] }))
  if (frames.length === 0) frames.push(freshFrame(s.mapId))
  return { id: s.id, name: s.name, mapId: s.mapId, frames, cursor: frames.length - 1, createdAt: s.createdAt }
}

function loadAll(): Sandbox[] {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? '[]') as LegacySandbox[]).map(migrate)
  } catch {
    return []
  }
}

function persist(list: Sandbox[]): void {
  localStorage.setItem(KEY, JSON.stringify(list))
}

export const sandboxes = writable<Sandbox[]>(loadAll())

/** Replace the sandbox list and persist it. */
function mutate(fn: (list: Sandbox[]) => Sandbox[]): void {
  sandboxes.update((list) => {
    const next = fn(list)
    persist(next)
    return next
  })
}

function update(id: string, fn: (s: Sandbox) => Sandbox): void {
  mutate((list) => list.map((s) => (s.id === id ? fn(s) : s)))
}

export function getSandbox(id: string): Sandbox | undefined {
  return loadAll().find((s) => s.id === id)
}

/** The frame currently being viewed. */
export const currentFrame = (s: Sandbox): Frame => s.frames[s.cursor]

export function createSandbox(name: string, mapId = 'classical'): Sandbox {
  const s: Sandbox = {
    id: crypto.randomUUID(),
    name: name.trim() || 'Sandbox',
    mapId,
    frames: [freshFrame(mapId)],
    cursor: 0,
    createdAt: new Date().toISOString(),
  }
  mutate((list) => [s, ...list])
  return s
}

/**
 * Copy a game's current board (and the viewer's draft orders for it) into a new
 * sandbox tied to that game. Reset returns to this copy, not the opening position.
 */
export function createSandboxFromGame(opts: {
  name: string
  mapId: string
  board: BoardState
  orders: AnyOrder[]
  origin: SandboxOrigin
}): Sandbox {
  const s: Sandbox = {
    id: crypto.randomUUID(),
    name: opts.name,
    mapId: opts.mapId,
    frames: [{ board: structuredClone(opts.board), orders: structuredClone(opts.orders) }],
    cursor: 0,
    createdAt: new Date().toISOString(),
    origin: opts.origin,
  }
  mutate((list) => [s, ...list])
  return s
}

/** The sandboxes copied from a game, newest first. */
export const sandboxesOf = (list: Sandbox[], gameId: string): Sandbox[] =>
  list.filter((s) => s.origin?.gameId === gameId)

export function deleteSandbox(id: string): void {
  mutate((list) => list.filter((s) => s.id !== id))
}

export function renameSandbox(id: string, name: string): void {
  update(id, (s) => ({ ...s, name: name.trim() || s.name }))
}

// ── navigation ──────────────────────────────────────────────────────────────

export function goBack(id: string): void {
  update(id, (s) => ({ ...s, cursor: Math.max(0, s.cursor - 1) }))
}

export function goForward(id: string): void {
  update(id, (s) => ({ ...s, cursor: Math.min(s.frames.length - 1, s.cursor + 1) }))
}

// ── editing & resolution ──────────────────────────────────────────────────────

/** Store the orders entered for the current phase. Non-destructive: the later
 *  history is preserved until you actually resolve (submit) — see resolveCurrent,
 *  which forks the timeline at submit time. */
export function setCurrentOrders(id: string, orders: AnyOrder[]): void {
  update(id, (s) => {
    const frames = [...s.frames]
    const frame = frames[s.cursor]
    // An edit invalidates the phase's results; re-saving the same orders (a revisit) keeps them.
    const same = JSON.stringify(frame.orders) === JSON.stringify(orders)
    frames[s.cursor] = same ? { ...frame, orders } : { board: frame.board, orders }
    return { ...s, frames }
  })
}

/** Resolve the current phase: adjudicate its orders, append the next frame, and
 *  advance the cursor onto it. Discards any future (re-fork). */
export function resolveCurrent(id: string, orders: AnyOrder[]): AdjudicationResult | null {
  const s = getSandbox(id)
  if (!s) return null
  const frame = s.frames[s.cursor]
  const result = adjudicate(getMap(s.mapId), frame.board, orders)
  update(id, (cur) => {
    const frames = cur.frames.slice(0, cur.cursor + 1)
    frames[cur.cursor] = { ...frames[cur.cursor], orders, results: result.results }
    frames.push({ board: result.newBoardState, orders: [] })
    return { ...cur, frames, cursor: cur.cursor + 1 }
  })
  return result
}
