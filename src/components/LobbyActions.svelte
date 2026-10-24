<script lang="ts">
  // Lobby footer action: Join (outsiders), Start (host), or a waiting note (members).
  export let canJoin: boolean
  export let joining: boolean
  /** The lobby has no open seat left. */
  export let full: boolean
  export let isAdmin: boolean
  export let isMember: boolean
  export let canStart: boolean
  export let starting: boolean
  /** Fewer than the two players a game needs. */
  export let needsPlayers: boolean
  export let onJoin: () => void
  export let onStart: () => void
</script>

<div class="lobby-actions">
  {#if canJoin}
    <button
      class="btn-join"
      disabled={joining}
      on:click={onJoin}
    >
      {#if joining}
        <div class="btn-spinner"></div>
        Joining...
      {:else}
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="8.5" cy="7" r="4" />
          <line x1="20" y1="8" x2="20" y2="14" />
          <line x1="23" y1="11" x2="17" y2="11" />
        </svg>
        Join Game
      {/if}
    </button>
    {#if full}
      <p class="start-hint">Game is full</p>
    {/if}
  {:else if isAdmin}
    <button
      class="btn-start"
      disabled={!canStart || starting}
      on:click={onStart}
    >
      {#if starting}
        <div class="btn-spinner"></div>
        Starting...
      {:else}
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        Start Game
      {/if}
    </button>
    {#if !canStart && !starting && needsPlayers}
      <p class="start-hint">Need at least 2 players to start</p>
    {/if}
  {:else if isMember}
    <p class="waiting-msg">Waiting for host to start the game...</p>
  {/if}
</div>

<style>
  .lobby-actions {
    margin-top: 12px;
    text-align: center;
  }

  .btn-join, .btn-start {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: 100%;
    padding: 14px 24px;
    font-size: 16px;
    font-weight: 700;
    color: white;
    background: linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%);
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    font-family: var(--font);
    transition: transform 0.1s, box-shadow 0.15s, opacity 0.15s;
    box-shadow: 0 2px 8px rgba(37, 99, 235, 0.3);
  }

  .btn-join {
    background: linear-gradient(135deg, var(--green) 0%, #047857 100%);
    box-shadow: 0 2px 8px rgba(5, 150, 105, 0.3);
  }

  .btn-join:hover:not(:disabled), .btn-start:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  .btn-join:hover:not(:disabled) {
    box-shadow: 0 4px 14px rgba(5, 150, 105, 0.4);
  }

  .btn-start:hover:not(:disabled) {
    box-shadow: 0 4px 14px rgba(37, 99, 235, 0.4);
  }

  .btn-join:active:not(:disabled), .btn-start:active:not(:disabled) {
    transform: translateY(0);
  }

  .btn-join:disabled, .btn-start:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    box-shadow: none;
  }

  .btn-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  .start-hint {
    font-size: 13px;
    color: var(--text-tertiary);
    margin: 10px 0 0;
  }

  .waiting-msg {
    font-size: 14px;
    color: var(--text-tertiary);
    margin: 0;
    padding: 14px;
    background: var(--bg-elevated);
    border-radius: var(--radius-md);
    border: 1px dashed var(--border);
    text-align: center;
  }
</style>
