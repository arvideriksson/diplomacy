import type { MapDefinition } from '../mapDefinition'
import { classicalMap } from './classical'
import { map1900 } from './1900'

export const maps: Record<string, MapDefinition> = {
  classical: classicalMap,
  '1900': map1900,
}

export function getMap(id: string): MapDefinition {
  const map = maps[id]
  if (!map) throw new Error(`Unknown map variant: ${id}`)
  return map
}

export { classicalMap }
