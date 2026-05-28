<script lang="ts">
  import { adminDeleteAllGames, fetchGames } from '../lib/game'

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
    } catch (e: any) {
      result = e.message ?? 'Failed to delete'
    } finally {
      deleting = false
    }
  }
</script>

<section class="admin-panel">
  <div class="admin-header">
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
    <h2>Admin</h2>
  </div>

  <div class="admin-actions">
    <div class="action-row">
      <div>
        <span class="action-title">Delete all games</span>
        <span class="action-desc">Permanently removes every game from the database</span>
      </div>
      <button class="btn-danger" on:click={handleDeleteAll} disabled={deleting}>
        {deleting ? 'Deleting...' : 'Delete all'}
      </button>
    </div>

    {#if result}
      <p class="result">{result}</p>
    {/if}
  </div>
</section>

<style>
  .admin-panel {
    background: var(--bg-card);
    border: 1px solid var(--red);
    border-radius: var(--radius-lg);
    padding: 22px 24px;
    margin-bottom: 24px;
  }

  .admin-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
    color: var(--red);
  }

  .admin-header h2 {
    font-size: 15px;
    font-weight: 600;
    margin: 0;
    color: var(--red);
  }

  .admin-actions {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .action-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .action-title {
    display: block;
    font-size: 14px;
    font-weight: 500;
    color: var(--text);
  }

  .action-desc {
    display: block;
    font-size: 12px;
    color: var(--text-tertiary);
    margin-top: 1px;
  }

  .btn-danger {
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

  .btn-danger:hover:not(:disabled) {
    opacity: 0.9;
  }

  .btn-danger:active:not(:disabled) {
    transform: scale(0.97);
  }

  .btn-danger:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .result {
    font-size: 13px;
    color: var(--text-secondary);
    margin: 0;
  }
</style>
