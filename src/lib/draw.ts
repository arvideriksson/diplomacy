// Ending a game by agreement: each surviving power's secret vote for a solo (the
// default), a tie with a set of powers, or a concession. The server ends the game once
// the survivors agree — see supabase/migrations/20250101000141_draw_votes.sql.
import { supabase } from './supabase'
import { rpc } from './rpc'
import type { BoardState } from './adjudicator'

/** A power's vote: play for the solo, share a tie with `members` (incl. self), or concede. */
export type DrawVote =
  | { kind: 'solo' }
  | { kind: 'tie'; members: string[] }
  | { kind: 'concede' }

interface VoteRow {
  nation: string
  members: string[] | null
}

function toVote(row: VoteRow | undefined): DrawVote {
  if (!row) return { kind: 'solo' }
  if (row.members == null) return { kind: 'concede' }
  return row.members.length > 1 ? { kind: 'tie', members: row.members } : { kind: 'solo' }
}

/** The caller's own vote (RLS shows no one else's while the game runs). */
export async function fetchMyVote(gameId: string, nation: string): Promise<DrawVote> {
  const { data, error } = await supabase
    .from('draw_votes')
    .select('nation, members')
    .eq('game_id', gameId)
    .eq('nation', nation)
    .maybeSingle()
  if (error) throw error
  return toVote((data as VoteRow | null) ?? undefined)
}

/** Every power's final vote — readable once the game is over. */
export async function fetchFinalVotes(gameId: string, nations: string[]): Promise<Record<string, DrawVote>> {
  const { data, error } = await supabase.from('draw_votes').select('nation, members').eq('game_id', gameId)
  if (error) throw error
  const rows = (data ?? []) as VoteRow[]
  return Object.fromEntries(nations.map((n) => [n, toVote(rows.find((r) => r.nation === n))]))
}

/** Record the caller's vote. Resolves true when it completed an agreement (game over). */
export async function setDrawVote(gameId: string, vote: DrawVote): Promise<boolean> {
  return rpc<boolean>('set_draw_vote', {
    p_game_id: gameId,
    p_members: vote.kind === 'tie' ? vote.members : null,
    p_concede: vote.kind === 'concede',
  })
}

/** Played powers still on the board (a unit or a supply center). Mirrors the server's
 *  surviving_nations(). */
export function survivingNations(board: BoardState, nations: string[]): string[] {
  const owners = new Set(Object.values(board.supplyCenters ?? {}))
  return nations.filter((n) => owners.has(n) || board.units.some((u) => u.nation === n))
}
