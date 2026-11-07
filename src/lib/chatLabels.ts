// How the press panel names and decorates conversations and nations for one viewer.
import { powerName, sameNation } from './powers'
import type { PowerDefinition } from './mapDefinition'
import type { PlayerInfo } from './game'

/** Fields the label helpers read — satisfied by both a channel and a draft. */
export type Labelled = { members: string[]; name: string | null; is_public?: boolean }

/** A conversation's members other than `nation` (the viewer). */
export const otherMembers = (members: string[], nation: string): string[] =>
  members.filter((n) => !sameNation(n, nation))

/** Display helpers for one viewer (`nation`) on a map's powers and the game's roster. */
export function chatLabels(powers: PowerDefinition[], nation: string, players: Record<string, PlayerInfo> = {}) {
  // nation → display name (matched by id or name, case-insensitive).
  const display = (n: string) => powerName(powers, n)
  // nation → the player's username (null when the seat has no named player).
  const users = new Map<string, string>()
  for (const p of Object.values(players)) if (p?.nation && p.display_name) users.set(p.nation.toLowerCase(), p.display_name)
  const userOf = (n: string): string | null => users.get(n.toLowerCase()) ?? null
  /** The player's username, falling back to the nation when there is none. */
  const who = (n: string): string => userOf(n) ?? display(n)
  const others = (c: Labelled) => otherMembers(c.members, nation)
  /** A one-to-one conversation (titled by the other player rather than a nation list). */
  const isDirect = (c: Labelled) => !c.is_public && others(c).length === 1
  const channelLabel = (c: Labelled): string => {
    if (c.name) return c.name
    if (c.is_public) return 'Public press'
    if (isDirect(c)) return who(others(c)[0])
    return others(c).map(display).join(', ') || 'Notes to self'
  }
  // For a named channel, show the member list as a subtitle so you know who's in it.
  const memberList = (c: Labelled): string => others(c).map(display).join(', ')
  return { powers, display, userOf, who, others, isDirect, channelLabel, memberList }
}
