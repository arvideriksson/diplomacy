<script lang="ts">
  // Centered full-page status for a route that is loading or failed: a spinner while
  // `loading`, then the message and an optional action button.
  export let loading = false
  export let message = ''
  export let actionLabel = ''
  export let onAction: (() => void) | null = null
</script>

<div class="status-page">
  {#if loading}<div class="spinner"></div>{/if}
  {#if message}<p>{message}</p>{/if}
  {#if actionLabel && onAction}
    <button class="btn" on:click={onAction}>{actionLabel}</button>
  {/if}
</div>

<style>
  .status-page {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 80px 24px;
    color: var(--text-secondary);
  }
</style>
