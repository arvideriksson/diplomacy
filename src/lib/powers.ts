// Nation lookups. A nation token may be a power id ('austria') or its display name
// ('Austria-Hungary'), in any case — orders, units and the UI use both — so every
// comparison here is case-insensitive and accepts either form.
import type { PowerDefinition } from './mapDefinition'

/** Whether two nation tokens name the same nation (case-insensitive). */
export const sameNation = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** The power a nation token (id or name, any case) refers to. */
export const findPower = (
  powers: readonly PowerDefinition[],
  nation: string | null | undefined,
): PowerDefinition | undefined =>
  nation ? powers.find((p) => sameNation(p.id, nation) || sameNation(p.name, nation)) : undefined

/** A nation's display name, falling back to the token itself when it isn't a known power. */
export const powerName = (powers: readonly PowerDefinition[], nation: string): string =>
  findPower(powers, nation)?.name ?? nation

/** A nation's colour, or `fallback` when it isn't a known power. */
export function powerColor(powers: readonly PowerDefinition[], nation: string): string | undefined
export function powerColor(powers: readonly PowerDefinition[], nation: string, fallback: string): string
export function powerColor(powers: readonly PowerDefinition[], nation: string, fallback?: string): string | undefined {
  return findPower(powers, nation)?.color ?? fallback
}
