<script lang="ts">
  import { adminDeleteAllGames, fetchGames } from '../lib/game'
  import { errorMessage } from '../lib/errors'
  import Icon from './Icon.svelte'

  let deleting = false
  let result = ''

  async function handleDeleteAll() {
    if (!confirm('Delete ALL games? This cannot be undone.')) return
    deleting = true
    result = ''
    try {
      const count = await adminDeleteAllGames()
      result = `Deleted ${count} game${count === 1 ? '' : 's'}`
      await fetchGames()
    } catch (e) {
      result = errorMessage(e)
    } finally {
      deleting = false
    }
  }
</script>

<details class="card admin-panel">
  <summary class="card-head admin-header">
    <span class="chevron"><Icon name="chevron-right" size={16} /></span>
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
    <h2>Admin</h2>
  </summary>

  <div class="admin-actions">
    <button class="delete-all" on:click={handleDeleteAll} disabled={deleting}>
      {deleting ? 'Deleting...' : 'Delete all games'}
    </button>
  </div>

  {#if result}
    <p class="result">{result}</p>
  {/if}
</details>

<style>
  .admin-panel {
    border-color: var(--red);
    margin-top: 24px;
  }

  .admin-header {
    list-style: none;
    margin-bottom: 0;
    cursor: pointer;
    user-select: none;
  }

  .admin-header::-webkit-details-marker {
    display: none;
  }

  .admin-panel[open] .admin-header {
    margin-bottom: 16px;
  }

  .chevron {
    display: flex;
    color: var(--red);
    transition: transform 0.18s ease;
  }

  .admin-panel[open] .chevron {
    transform: rotate(90deg);
  }

  .admin-header svg,
  .admin-header h2 {
    color: var(--red);
  }

  .admin-actions {
    display: flex;
    gap: 10px;
  }

  .delete-all {
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 600;
    color: white;
    background: var(--red);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-family: var(--font);
    white-space: nowrap;
    transition: opacity 0.12s, transform 0.1s;
  }

  .delete-all:hover:not(:disabled) {
    opacity: 0.9;
  }

  .delete-all:active:not(:disabled) {
    transform: scale(0.97);
  }

  .delete-all:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .result {
    font-size: 13px;
    color: var(--text-secondary);
    margin: 0;
  }
</style>
