import type { MapDefinition } from '../mapDefinition'
import { standardMap } from './standard'

export const maps: Record<string, MapDefinition> = {
  standard: standardMap,
}

export function getMap(id: string): MapDefinition {
  const map = maps[id]
  if (!map) throw new Error(`Unknown map variant: ${id}`)
  return map
}

export { standardMap }
