export interface MapDefinition {
  id: string
  name: string
  description: string
  playerCount: number
  /** Legacy inline-SVG fields — unused now that maps render from the layered dSVG. */
  viewBox?: string
  svgContent?: string
  powers: PowerDefinition[]
  territories: Record<string, TerritoryDefinition>
  startingUnits: StartingUnit[]
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
