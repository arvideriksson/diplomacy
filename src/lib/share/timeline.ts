import { adjudicate } from '../adjudicator'
import type { AnyOrder, BoardState } from '../adjudicator'
import { getMap } from '../maps'
import type { Frame, Sandbox } from '../sandbox'

/** The portable content, independent of local identity and storage. */
export type SandboxContent = Pick<Sandbox, 'name' | 'mapId' | 'frames' | 'cursor'>
export interface TimelineEntry {
  orders: AnyOrder[]
  showResults: boolean
  /** The next board, present only when replaying these orders would differ. */
  checkpoint?: BoardState
}
export interface ShareTimeline {
  name: string
  mapId: string
  initialBoard: BoardState
  cursor: number
  entries: TimelineEntry[]
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(record).filter(key => record[key] !== undefined).sort().map(key => [key, stable(record[key])]))
  }
  return value
}
const same = (a: unknown, b: unknown) => JSON.stringify(stable(a)) === JSON.stringify(stable(b))
function checkCursor(cursor: number, frames: number): void {
  if (!frames || frames > 1024 || !Number.isInteger(cursor) || cursor < 0 || cursor >= frames) throw Error('Invalid sandbox timeline')
}
function checkBoard(board: BoardState, map: ReturnType<typeof getMap>): void {
  const powers = new Set(map.powers.map(power => power.id))
  const validUnit = (unit: BoardState['units'][number]) => {
    const territory = map.territories[unit.territory]
    return territory && powers.has(unit.nation) && (unit.type === 'army' || unit.type === 'fleet') &&
      (unit.type === 'army' ? territory.type !== 'sea' : territory.type !== 'land') &&
      (!unit.coast || Boolean(territory.coasts?.[unit.coast]))
  }
  if (board.mapId !== map.id || !Number.isSafeInteger(board.year) || board.year < 1 || board.year > 65535 ||
    !['Spring', 'Fall'].includes(board.season) || !['movement', 'retreat', 'build'].includes(board.phase) ||
    !Array.isArray(board.units) || board.units.length > Object.keys(map.territories).length ||
    board.units.some(unit => !validUnit(unit)) || new Set(board.units.map(unit => unit.territory)).size !== board.units.length ||
    !board.supplyCenters || Object.entries(board.supplyCenters).some(([id, owner]) => !map.territories[id]?.supplyCenter || !powers.has(owner)) ||
    !Array.isArray(board.dislodged) || board.dislodged.length > Object.keys(map.territories).length ||
    board.dislodged.some(item => !validUnit(item.unit) || (item.attackedFrom && !map.territories[item.attackedFrom])) ||
    !Array.isArray(board.contested) || board.contested.length > Object.keys(map.territories).length ||
    board.contested.some(id => !map.territories[id])) throw Error('Invalid sandbox board')
}

/** Current store -> portable timeline. Preserves edited pasts and migrated snapshots. */
export function toTimeline(sandbox: SandboxContent): ShareTimeline {
  checkCursor(sandbox.cursor, sandbox.frames.length)
  const map = getMap(sandbox.mapId)
  const coastNames = new Set(Object.values(map.territories).flatMap(territory => Object.keys(territory.coasts ?? {})))
  const entries = sandbox.frames.map((frame, i) => {
    checkBoard(frame.board, map)
    if (!Array.isArray(frame.orders) || frame.orders.length > 256 || frame.orders.some(order => {
      const o = order as AnyOrder & { target?: string; aux?: string; targetCoast?: string; viaConvoy?: boolean; unitType?: string }
      return !o || !['Hold', 'Move', 'Support', 'Convoy', 'Retreat', 'Disband', 'Build', 'Remove'].includes(o.type) ||
        !map.powers.some(power => power.id === o.nation) || !map.territories[o.source] ||
        (o.target !== undefined && !map.territories[o.target]) || (o.aux !== undefined && !map.territories[o.aux]) ||
        (o.sourceCoast !== undefined && !coastNames.has(o.sourceCoast)) ||
        (o.targetCoast !== undefined && !coastNames.has(o.targetCoast)) ||
        (o.viaConvoy !== undefined && typeof o.viaConvoy !== 'boolean') ||
        (o.unitType !== undefined && !['army', 'fleet'].includes(o.unitType))
    })) throw Error('Invalid sandbox orders')
    const next = sandbox.frames[i + 1]
    const result = next || frame.results ? adjudicate(map, frame.board, frame.orders) : undefined
    // Stored result text is derived. Refuse stale results instead of silently changing them.
    if (frame.results && !same(frame.results, result!.results)) throw Error('Stored resolution results do not match this engine')
    return {
      orders: structuredClone(frame.orders), showResults: frame.results !== undefined,
      ...(next && !same(next.board, result!.newBoardState) ? { checkpoint: structuredClone(next.board) } : {}),
    }
  })
  return { name: sandbox.name, mapId: sandbox.mapId, initialBoard: structuredClone(sandbox.frames[0].board), cursor: sandbox.cursor, entries }
}
/** Portable timeline -> the existing UI/store shape. No localStorage or network access. */
export function fromTimeline(timeline: ShareTimeline): SandboxContent {
  checkCursor(timeline.cursor, timeline.entries.length)
  const map = getMap(timeline.mapId), frames: Frame[] = []
  checkBoard(timeline.initialBoard, map)
  let board = structuredClone(timeline.initialBoard)
  timeline.entries.forEach((entry, i) => {
    const next = i + 1 < timeline.entries.length
    if (!next && entry.checkpoint) throw Error('Checkpoint beyond last frame')
    if (entry.checkpoint) checkBoard(entry.checkpoint, map)
    const orders = structuredClone(entry.orders)
    const result = next || entry.showResults ? adjudicate(map, board, orders) : undefined
    frames.push({ board, orders, ...(entry.showResults ? { results: result!.results } : {}) })
    if (next) board = entry.checkpoint ? structuredClone(entry.checkpoint) : result!.newBoardState
  })
  return { name: timeline.name, mapId: timeline.mapId, frames, cursor: timeline.cursor }
}
