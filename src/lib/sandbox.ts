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
import type { AdjudicationResult, AnyOrder, BoardState } from './adjudicator'
import { getMap } from './maps'

export interface Frame {
  /** Board state going into this phase. */
  board: BoardState
  /** Orders entered for this phase (preset when revisiting). */
  orders: AnyOrder[]
}

export interface Sandbox {
  id: string
  name: string
  mapId: string
  frames: Frame[]
  /** Index of the phase currently being viewed. */
  cursor: number
  createdAt: string
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

function migrate(s: LegacySandbox): Sandbox {
  if (s.frames) return s as Sandbox
  const boards = [...(s.past ?? []), s.board].filter(Boolean) as BoardState[]
  const frames: Frame[] = boards.map((board) => ({ board, orders: [] }))
  if (frames.length === 0) frames.push({ board: initialBoard(getMap(s.mapId)), orders: [] })
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

function update(id: string, fn: (s: Sandbox) => Sandbox): void {
  sandboxes.update((list) => {
    const next = list.map((s) => (s.id === id ? fn(s) : s))
    persist(next)
    return next
  })
}

function getSandbox(id: string): Sandbox | undefined {
  return loadAll().find((s) => s.id === id)
}

export function createSandbox(name: string, mapId = 'classical'): Sandbox {
  const s: Sandbox = {
    id: crypto.randomUUID(),
    name: name.trim() || 'Sandbox',
    mapId,
    frames: [{ board: initialBoard(getMap(mapId)), orders: [] }],
    cursor: 0,
    createdAt: new Date().toISOString(),
  }
  sandboxes.update((list) => {
    const next = [s, ...list]
    persist(next)
    return next
  })
  return s
}

export function deleteSandbox(id: string): void {
  sandboxes.update((list) => {
    const next = list.filter((s) => s.id !== id)
    persist(next)
    return next
  })
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
    frames[s.cursor] = { ...frames[s.cursor], orders }
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
    frames[cur.cursor] = { ...frames[cur.cursor], orders }
    frames.push({ board: result.newBoardState, orders: [] })
    return { ...cur, frames, cursor: cur.cursor + 1 }
  })
  return result
}

export function resetSandbox(id: string): void {
  update(id, (s) => ({ ...s, frames: [{ board: initialBoard(getMap(s.mapId)), orders: [] }], cursor: 0 }))
}

export function exportSandbox(id: string): string {
  return JSON.stringify(getSandbox(id) ?? {}, null, 2)
}
