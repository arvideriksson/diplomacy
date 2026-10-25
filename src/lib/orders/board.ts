// Pure order-entry derivations behind the game board's order panel: what the map
// highlights, what the panel prompts, and how an entered order set is drawn. Entry-time
// legality only — resolution stays in the adjudicator.
import type { MapDefinition } from '../mapDefinition'
import type { Unit } from '../types'
import type { DislodgedUnit, OrderResult } from '../adjudicator/types'
import type { OrderState } from '../map/mapRenderer'
import { toDsvgId } from '../map/idMap'
import { toOrderStates, type Draft, type Step } from './wizard'
import { retreatTargets, type BuildSituation, type BuildSpot } from './adjustments'
import type { AnyOrder, BuildOrder, Order, OrderType, RetreatOrder } from './types'

/** The province an order is keyed by (every order kind has one). */
export const orderSource = (o: AnyOrder): string => (o as { source: string }).source

/**
 * The adjudicator holds any movement unit without an order. Make that explicit on
 * submit so the locked-in set the player sees is the set that actually resolves —
 * un-ordered `units` appear as Holds rather than silently vanishing. Other phases
 * pass through unchanged.
 */
export function withImplicitHolds(set: AnyOrder[], phase: string, units: Unit[]): AnyOrder[] {
  if (phase !== 'movement') return set
  const ordered = new Set(set.map(orderSource))
  const holds: Order[] = units
    .filter((u) => !ordered.has(u.territory))
    .map((u) => ({ type: 'Hold', nation: u.nation, source: u.territory, sourceCoast: u.coast }))
  return [...set, ...holds]
}

/**
 * Group destinations that carry a note ("via convoy", "long route…") so the panel can
 * explain them; plain destinations are just highlighted on the map.
 * Returns `[Note, "Name, Name"]` pairs.
 */
export function choiceNotes(choices: { label: string }[]): [string, string][] {
  const groups = new Map<string, string[]>()
  for (const c of choices) {
    const m = c.label.match(/^(.*) \((via convoy|long route, half strength)\)$/)
    if (m) groups.set(m[2], [...(groups.get(m[2]) ?? []), m[1]])
  }
  return [...groups].map(([note, names]) => [note[0].toUpperCase() + note.slice(1), names.join(', ')])
}

/** Coast-specific retreat destinations for a dislodged unit (none when `d` is missing). */
export function retreatChoices(
  map: MapDefinition,
  d: DislodgedUnit | undefined,
  units: Unit[],
  contested: string[],
): Array<{ province: string; coast?: string }> {
  if (!d) return []
  const out: Array<{ province: string; coast?: string }> = []
  for (const t of retreatTargets(map, d.unit, d.attackedFrom, units, contested)) {
    if (t.coasts.length > 0) for (const c of t.coasts) out.push({ province: t.province, coast: c })
    else out.push({ province: t.province })
  }
  return out
}

/** A nation's build situation, tagged with the nation. */
export type NationSituation = BuildSituation & { nation: string }

const placed = (orders: AnyOrder[], type: 'Build' | 'Remove', n: string): number =>
  orders.filter((o) => o.type === type && (o as BuildOrder).nation === n).length

/** Open home centers still buildable (nation under its build quota, center not yet ordered). */
export function openBuildSpots(
  situations: NationSituation[],
  orders: AnyOrder[],
): Array<BuildSpot & { nation: string }> {
  return situations
    .filter((s) => s.delta > 0 && placed(orders, 'Build', s.nation) < s.delta)
    .flatMap((s) =>
      s.spots
        .filter((sp) => !orders.some((o) => o.type === 'Build' && (o as BuildOrder).source === sp.province))
        .map((sp) => ({ ...sp, nation: s.nation })),
    )
}

/** Units still removable (nation owes removals, not yet ordered). */
export function openRemovals(
  situations: NationSituation[],
  orders: AnyOrder[],
): Array<{ territory: string; nation: string }> {
  return situations
    .filter((s) => s.delta < 0 && placed(orders, 'Remove', s.nation) < -s.delta)
    .flatMap((s) =>
      s.removable
        .filter((u) => !orders.some((o) => o.type === 'Remove' && (o as BuildOrder).source === u.territory))
        .map((u) => ({ territory: u.territory, nation: s.nation })),
    )
}

/** The build-phase panel prompt for the given situations. */
export function buildPrompt(situations: NationSituation[]): string {
  const builds = situations.filter((s) => s.delta > 0).reduce((a, s) => a + s.delta, 0)
  const removes = situations.filter((s) => s.delta < 0).reduce((a, s) => a - s.delta, 0)
  if (builds && removes) return 'Select a highlighted home center to build, or a unit to remove.'
  if (builds) return `Select a highlighted home center to build (${builds} available).`
  if (removes) return `Select a highlighted unit to remove (${removes} required).`
  return 'No adjustments needed this phase.'
}

/**
 * Spell out a coast code for display (the terse Stp(sc) form is for notation), from
 * the map's own coast names: "North Coast" → "North".
 */
export const coastName = (map: MapDefinition, province: string, c: string): string =>
  map.territories[province]?.coasts?.[c]?.name.replace(/ Coast$/, '') ?? c

const MOVE_TYPES = ['Hold', 'Move', 'Support', 'Convoy']

/**
 * Map overlays per order kind: movement/retreat as arrows, builds as ghost unit
 * tokens, removes/disbands as red markers. `failed` (history) marks orders that
 * didn't succeed, which the renderer crosses out.
 */
export function toRenderOrders(src: AnyOrder[], failed?: (o: AnyOrder) => boolean): OrderState[] {
  const mark = (o: AnyOrder, s: OrderState): OrderState => (failed?.(o) ? { ...s, failed: true } : s)
  const moves = src.filter((o) => MOVE_TYPES.includes(o.type)) as Order[]
  const out: OrderState[] = toOrderStates(moves).map((s, i) => mark(moves[i], s))
  for (const o of src) {
    if (o.type === 'Retreat') {
      const r = o as RetreatOrder
      out.push(mark(o, { type: 'Move', nation: r.nation, source: toDsvgId(r.source, r.sourceCoast), target: toDsvgId(r.target ?? '', r.targetCoast), dislodged: true }))
    } else if (o.type === 'Disband') {
      const r = o as RetreatOrder
      out.push(mark(o, { type: 'Disband', nation: r.nation, source: toDsvgId(r.source, r.sourceCoast), dislodged: true }))
    } else if (o.type === 'Build') {
      const b = o as BuildOrder
      out.push(mark(o, { type: 'Build', nation: b.nation, source: toDsvgId(b.source, b.sourceCoast), unitType: b.unitType === 'fleet' ? 'Fleet' : 'Army' }))
    } else if (o.type === 'Remove') {
      const b = o as BuildOrder
      out.push(mark(o, { type: 'Disband', nation: b.nation, source: toDsvgId(b.source) }))
    }
  }
  return out
}

/**
 * Whether a resolved order didn't do what it asked: a bounced/cut/void order, a unit
 * dislodged while holding or supporting, or a retreat that ended in a disband.
 */
export const orderFailed = (r: OrderResult): boolean =>
  r.code === 'fails' || r.code === 'void' || r.code === 'bounced' || r.code === 'dislodged' ||
  (r.code === 'disbanded' && r.order.type === 'Retreat')

/**
 * Retreat-phase map inputs (dSVG ids). Idle: highlight the dislodged units still
 * awaiting an order (a routed/disbanded one drops its highlight — its order overlay
 * carries the cue — but stays clickable). With `selected` picked: its destinations.
 */
export function retreatMapInputs(
  map: MapDefinition,
  dislodged: DislodgedUnit[],
  orders: AnyOrder[],
  units: Unit[],
  contested: string[],
  selected: string | null,
): { highlighted: string[]; selectable: string[] } {
  if (selected) {
    const d = dislodged.find((x) => x.unit.territory === selected)
    const highlighted = retreatChoices(map, d, units, contested).map((c) => toDsvgId(c.province, c.coast))
    return { highlighted, selectable: [...highlighted, toDsvgId(selected)] }
  }
  return {
    highlighted: dislodged
      .filter((d) => !orders.some((o) => orderSource(o) === d.unit.territory))
      .map((d) => toDsvgId(d.unit.territory)),
    selectable: dislodged.map((d) => toDsvgId(d.unit.territory)),
  }
}

/**
 * Build-phase map inputs (dSVG ids): open build spots and removable units (drawn as
 * dashed rings, not stripe highlights), plus placed builds/removes, which stay
 * clickable so they can be undone.
 */
export function buildMapInputs(
  spots: Array<{ province: string }>,
  removals: Array<{ territory: string }>,
  orders: AnyOrder[],
): { buildIds: string[]; removeIds: string[]; selectable: string[] } {
  const buildIds = spots.map((sp) => toDsvgId(sp.province))
  const removeIds = removals.map((r) => toDsvgId(r.territory))
  const placed = orders.filter((o) => o.type === 'Build' || o.type === 'Remove').map((o) => toDsvgId(orderSource(o)))
  return { buildIds, removeIds, selectable: [...buildIds, ...removeIds, ...placed] }
}

/** Units with no order yet (dSVG ids), except `drafting` — mid-edit, not forgotten. */
export const unorderedUnitIds = (units: Unit[], orders: AnyOrder[], drafting?: string): string[] =>
  units
    .filter((u) => u.territory !== drafting && !orders.some((o) => orderSource(o) === u.territory))
    .map((u) => toDsvgId(u.territory))

/** Keyboard shortcuts while a movement draft is open: H hold, M move, S support, C convoy. */
export const ORDER_TYPE_KEYS: Record<string, OrderType> = { h: 'Hold', m: 'Move', s: 'Support', c: 'Convoy' }

/**
 * Apply a clicked province (dSVG id) to a movement draft at a province step. A target
 * choice may carry a coast (multi-coast destinations); a chain choice extends the
 * convoy route. Null when the click isn't one of the step's choices.
 */
export function applyChoice(
  draft: Draft,
  step: Extract<Step, { kind: 'province' }>,
  dsvgId: string,
): Draft | null {
  const choice = step.choices.find((c) => toDsvgId(c.id, c.coast) === dsvgId)
  if (!choice) return null
  if (choice.chain) return { ...draft, convoyPath: [...(draft.convoyPath ?? []), choice.id] }
  if (step.field === 'target') return { ...draft, target: choice.id, targetCoast: choice.coast }
  if (step.field === 'coast') return { ...draft, targetCoast: choice.coast }
  if (step.field === 'aux') return { ...draft, aux: choice.id }
  return draft
}

/**
 * Add a finished movement order to `orders`. A convoy route picked fleet by fleet also
 * orders the route's fleets that `mayOrder` allows to convoy it (other powers' fleets
 * must be arranged through diplomacy). Any earlier order for those units is replaced.
 */
export function commitMove(
  orders: AnyOrder[],
  order: Order,
  convoyPath: string[] | undefined,
  units: Unit[],
  mayOrder: (nation: string) => boolean,
): AnyOrder[] {
  const convoys: Order[] = (convoyPath ?? [])
    .map((p) => units.find((u) => u.territory === p))
    .filter((f): f is Unit => Boolean(f) && mayOrder(f!.nation))
    .map((f) => ({ type: 'Convoy', nation: f.nation, source: f.territory, aux: order.source, target: order.target }))
  const touched = new Set([order.source, ...convoys.map((c) => c.source)])
  return [...orders.filter((o) => !touched.has(o.source)), order, ...convoys]
}
