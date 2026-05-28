<script lang="ts">
  import { fade, fly, slide } from 'svelte/transition'
  import { flip } from 'svelte/animate'
  import { games, fetchGames, createGame, joinGameByCode } from '../lib/game'
  import { user } from '../lib/auth'
  import type { GameState } from '../lib/game'

  let newGameName = ''
  let isPrivate = false
  let creating = false

  let joinCode = ''
  let joining = false
  let joinError = ''
  let copied = ''

  async function handleCreate() {
    if (!newGameName.trim() || !$user) return
    creating = true
    try {
      const game = await createGame(newGameName.trim(), $user.id, isPrivate)
      newGameName = ''
      isPrivate = false
      onSelectGame(game)
    } finally {
      creating = false
    }
  }

  async function handleJoin() {
    if (!joinCode.trim()) return
    joining = true
    joinError = ''
    try {
      await joinGameByCode(joinCode.trim())
      joinCode = ''
      await fetchGames()
    } catch (e: any) {
      joinError = e.message ?? 'Invalid invite code'
    } finally {
      joining = false
    }
  }

  function copyInviteCode(code: string) {
    navigator.clipboard.writeText(code)
    copied = code
    setTimeout(() => (copied = ''), 1500)
  }

  export let onSelectGame: (game: GameState) => void = () => {}
</script>

<div class="game-list">
  <div class="actions-row">
    <div class="action-card">
      <div class="action-label">Create a new game</div>
      <div class="action-form">
        <input
          bind:value={newGameName}
          placeholder="Game name"
          on:keydown={(e) => e.key === 'Enter' && handleCreate()}
        />
        <button class="btn btn-primary" on:click={handleCreate} disabled={creating || !newGameName.trim()}>
          {creating ? 'Creating...' : 'Create'}
        </button>
      </div>
      <label class="private-toggle">
        <input type="checkbox" bind:checked={isPrivate} />
        <span class="toggle-track"><span class="toggle-thumb"></span></span>
        <span class="toggle-text">{isPrivate ? 'Private' : 'Public'}</span>
        {#if isPrivate}
          <span class="toggle-hint" transition:fade={{ duration: 120 }}>Invite code required to join</span>
        {/if}
      </label>
    </div>

    <div class="action-card">
      <div class="action-label">Join with invite code</div>
      <div class="action-form">
        <input
          bind:value={joinCode}
          placeholder="ABC123"
          maxlength="6"
          on:keydown={(e) => e.key === 'Enter' && handleJoin()}
          class="code-input"
        />
        <button class="btn btn-secondary" on:click={handleJoin} disabled={joining || !joinCode.trim()}>
          {joining ? 'Joining...' : 'Join'}
        </button>
      </div>
      {#if joinError}
        <p class="error" transition:slide={{ duration: 150 }}>{joinError}</p>
      {/if}
    </div>
  </div>

  <div class="games">
    {#each $games as game (game.id)}
      <div
        class="game-card"
        role="button"
        tabindex="0"
        on:click={() => onSelectGame(game)}
        on:keydown={(e) => e.key === 'Enter' && onSelectGame(game)}
        transition:fly={{ y: 12, duration: 250 }}
        animate:flip={{ duration: 250 }}
      >
        <div class="card-left">
          <div class="card-title-row">
            <h3>{game.name}</h3>
            {#if game.is_private}
              <span class="visibility-badge private">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Private
              </span>
            {:else}
              <span class="visibility-badge public">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20" />
                </svg>
                Public
              </span>
            {/if}
          </div>
          <div class="card-meta">
            <span class="phase-pill">{game.phase}</span>
            <span class="season">{game.season} {game.year}</span>
            <span class="player-count">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              {Object.keys(game.players).length}/7
            </span>
          </div>
        </div>
        {#if game.invite_code}
          <button
            class="invite-chip"
            class:copied={copied === game.invite_code}
            on:click|stopPropagation={() => copyInviteCode(game.invite_code ?? '')}
            title="Copy invite code"
          >
            {copied === game.invite_code ? 'Copied!' : game.invite_code}
          </button>
        {:else}
          <svg class="card-arrow" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        {/if}
      </div>
    {:else}
      <div class="empty-state" transition:fade>
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.2">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        <p>No games yet</p>
        <p class="sub">Create a game or join one with an invite code.</p>
      </div>
    {/each}
  </div>
</div>

<style>
  .game-list {
    width: 100%;
  }

  .actions-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 32px;
  }

  @media (max-width: 600px) {
    .actions-row {
      grid-template-columns: 1fr;
    }
  }

  .action-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 18px 20px;
  }

  .action-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 12px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  .action-form {
    display: flex;
    gap: 8px;
  }

  input {
    flex: 1;
    padding: 9px 13px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 14px;
    outline: none;
    background: var(--bg-input);
    color: var(--text);
    transition: border-color 0.15s, box-shadow 0.15s;
    min-width: 0;
  }

  input::placeholder {
    color: var(--text-tertiary);
  }

  input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-subtle);
  }

  .code-input {
    font-family: var(--mono);
    font-size: 15px;
    letter-spacing: 3px;
    text-transform: uppercase;
    text-align: center;
  }

  .btn {
    padding: 9px 18px;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.12s, transform 0.1s, box-shadow 0.12s;
    white-space: nowrap;
    font-family: var(--font);
  }

  .btn:active:not(:disabled) {
    transform: scale(0.97);
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--accent);
    color: var(--text-inverse);
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
    box-shadow: var(--shadow-sm);
  }

  .btn-secondary {
    background: var(--bg-elevated);
    color: var(--text);
    border: 1px solid var(--border);
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  .private-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
    cursor: pointer;
    user-select: none;
  }

  .private-toggle input[type="checkbox"] {
    display: none;
  }

  .toggle-track {
    width: 34px;
    height: 20px;
    background: var(--border-strong);
    border-radius: var(--radius-full);
    position: relative;
    transition: background 0.2s;
    flex-shrink: 0;
  }

  .private-toggle input:checked + .toggle-track {
    background: var(--amber);
  }

  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    background: white;
    border-radius: 50%;
    transition: transform 0.2s;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  }

  .private-toggle input:checked + .toggle-track .toggle-thumb {
    transform: translateX(14px);
  }

  .toggle-text {
    font-size: 13px;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .toggle-hint {
    font-size: 12px;
    color: var(--text-tertiary);
  }

  .error {
    color: var(--red);
    font-size: 13px;
    margin: 8px 0 0;
  }

  .games {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .game-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 16px 20px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: border-color 0.15s, box-shadow 0.15s, transform 0.1s;
    outline: none;
  }

  .game-card:hover {
    border-color: var(--border-strong);
    box-shadow: var(--shadow-md);
  }

  .game-card:focus-visible {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-subtle);
  }

  .game-card:active {
    transform: scale(0.995);
  }

  .card-left {
    min-width: 0;
    flex: 1;
  }

  .card-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .card-title-row h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .visibility-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
  }

  .visibility-badge.private {
    background: var(--amber-subtle);
    color: var(--amber);
  }

  .visibility-badge.public {
    background: var(--green-subtle);
    color: var(--green);
  }

  .card-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .phase-pill {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 8px;
    border-radius: var(--radius-full);
    background: var(--accent-subtle);
    color: var(--accent);
  }

  .season {
    font-size: 13px;
    color: var(--text-tertiary);
  }

  .player-count {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: var(--text-tertiary);
  }

  .card-arrow {
    color: var(--text-tertiary);
    flex-shrink: 0;
    transition: transform 0.15s;
  }

  .game-card:hover .card-arrow {
    transform: translateX(2px);
  }

  .invite-chip {
    font-family: var(--mono);
    font-size: 12px;
    letter-spacing: 1.5px;
    padding: 4px 10px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
    flex-shrink: 0;
    font-weight: 500;
  }

  .invite-chip:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .invite-chip.copied {
    border-color: var(--green);
    color: var(--green);
    background: var(--green-subtle);
  }

  .empty-state {
    text-align: center;
    padding: 60px 20px;
    color: var(--text-tertiary);
  }

  .empty-state svg {
    margin-bottom: 16px;
    opacity: 0.4;
  }

  .empty-state p {
    margin: 0;
    font-size: 15px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .empty-state .sub {
    font-size: 13px;
    font-weight: 400;
    color: var(--text-tertiary);
    margin-top: 4px;
  }
</style>
