// Pure, dependency-free shared types. This module MUST NOT import anything with a
// runtime side effect (no svelte, no supabase, no import.meta.env) so that the
// adjudicator engine and the Supabase Edge Function (Deno) can import it cleanly.

/** A unit on the board. Identified by its province (one unit per province). */
export interface Unit {
  type: 'army' | 'fleet'
  /** Lowercase power id, e.g. 'england' (matches PowerDefinition.id). */
  nation: string
  /** Province id (3-letter uppercase key into MapDefinition.territories). */
  territory: string
  /** Named coast (e.g. 'nc', 'sc', 'ec') for fleets in multi-coast provinces. */
  coast?: string
}
