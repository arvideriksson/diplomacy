export interface MapDefinition {
  id: string
  name: string
  description: string
  playerCount: number
  /** Opening movement year; defaults to 1901 for classical maps. */
  startingYear?: number
  /** Supply centers owned at setup, including occupied foreign centers. */
  initialOwnership?: Record<string, string>
  /** Supply centers needed to win; defaults to a majority of the map's centers. */
  victoryCenters?: number
  /** Legacy inline-SVG fields — unused now that maps render from the layered dSVG. */
  viewBox?: string
  svgContent?: string
  powers: PowerDefinition[]
  territories: Record<string, TerritoryDefinition>
  startingUnits: StartingUnit[]
  /** Variant-specific rules on top of the standard rulebook. */
  rules?: VariantRules
}

/** Optional variant rules the engine understands (all absent on the classical map). */
export interface VariantRules {
  /**
   * Province pairs joined by a long sea route (1900: Egypt/Hejaz <-> Mid-Atlantic,
   * around Africa). Moves along one are at half strength; a unit cannot support
   * across one; an attack along one cuts support only by dislodging; an army
   * convoyed into a province only via one attacks at half strength; and a retreat
   * along one loses to a competing ordinary retreat.
   */
  longRoutes?: [string, string][]
  /** Coastal provinces whose fleets may convoy as if at sea (1900: Gibraltar). */
  convoyCoasts?: string[]
  /** Centers that count as a nation's home only for civil-disorder removals (1900: Egypt, Algeria). */
  disorderHomes?: Record<string, string[]>
  /**
   * Emergency measures (1900 Russia): while the nation holds at least one but not
   * all of its home centers it may keep one unit more than its center count and
   * may build in `buildSite` (never a supply center) when it is unoccupied.
   */
  emergency?: { nation: string; buildSite: string }
  /** A winner must also hold strictly more centers than every other power; ties play on. */
  strictVictory?: boolean
}

export interface PowerDefinition {
  id: string
  name: string
  color: string
}

export interface TerritoryDefinition {
  name: string
  type: 'land' | 'sea' | 'coast'
  supplyCenter: boolean
  homePower?: string
  coasts?: Record<string, CoastDefinition>
  /** General province adjacency (army + convoy graph): land and coast borders. */
  adjacent: string[]
  /**
   * Sea-border adjacency for single-coast coastal provinces — the provinces a
   * fleet here may sail to. Required on every coastal province WITHOUT named
   * `coasts` (multi-coast provinces carry per-coast `fleetAdjacency` instead).
   * Seas omit it: their `adjacent` is already all sea-reachable.
   */
  fleetAdjacent?: string[]
  render: TerritoryRender
}

export interface CoastDefinition {
  name: string
  fleetAdjacency: string[]
  render: { center: [number, number] }
}

export interface TerritoryRender {
  center: [number, number]
  path?: string
  labelOffset?: [number, number]
}

export interface StartingUnit {
  type: 'army' | 'fleet'
  power: string
  territory: string
  coast?: string
}

export function canArmyEnter(t: TerritoryDefinition): boolean {
  return t.type === 'land' || t.type === 'coast'
}

export function canFleetEnter(t: TerritoryDefinition): boolean {
  return t.type === 'sea' || t.type === 'coast'
}
