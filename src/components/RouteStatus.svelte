<script lang="ts">
  // A route's loading or failure screen: a spinner (with an optional message), or the
  // error with a way back to the game list.
  export let error = ''
  export let message = ''
  export let onBack: () => void
</script>

<div class="route-status">
  {#if error}
    <p>{error}</p>
    <button class="btn" on:click={onBack}>Back to games</button>
  {:else}
    <div class="spinner"></div>
    {#if message}<p>{message}</p>{/if}
  {/if}
</div>

<style>
  .route-status {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 80px 24px;
    color: var(--text-secondary, #777);
  }
  .btn {
    padding: 8px 16px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-card, #fff);
    color: var(--text, #1a1a1a);
    cursor: pointer;
  }
</style>
