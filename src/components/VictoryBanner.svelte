<script lang="ts">
  // End-of-game notice in the board sidebar: the solo winner (or shared win), the agreed tie or win by
  // concession, or a plain "game over" when the game ended without one.
  /** `names`: every power sharing the win when several tie for the most centers (Era of Empire). */
  export let winner: { name: string; centers: number; names?: string[] } | null | undefined = null
  /** The game ended by the players' votes. */
  export let result: { kind: 'draw' | 'concession'; names: string[] } | null | undefined = null

  const list = (names: string[]) =>
    names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
</script>

<div class="victory" role="status">
  {#if result?.kind === 'concession'}🏆 {result.names[0]} wins: every other power conceded.
  {:else if result}🤝 {result.names.length}-way tie between {list(result.names)}.
  {:else if winner?.names && winner.names.length > 1}🏆 {list(winner.names)} share the victory with {winner.centers} supply centers each.
  {:else if winner}🏆 {winner.name} wins with {winner.centers} supply centers.{:else}This game is over.{/if}
</div>

<style>
  .victory {
    padding: 12px 14px;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--amber) 16%, var(--bg-card));
    border: 1px solid color-mix(in srgb, var(--amber) 45%, transparent);
    font-weight: 600;
  }
</style>
