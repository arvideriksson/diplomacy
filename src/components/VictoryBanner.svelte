<script lang="ts">
  // End-of-game notice in the board sidebar: the winner, or a plain "game over" when
  // the game ended without one.
  export let winner: { name: string; centers: number } | null | undefined = null
</script>

<div class="victory" role="status">
  {#if winner}🏆 {winner.name} wins with {winner.centers} supply centers.{:else}This game is over.{/if}
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
