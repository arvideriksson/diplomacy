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

  async function handleCreate() {
    if (!newGameName.trim() || !$user) return
    creating = true
    try {
      await createGame(newGameName.trim(), $user.id, isPrivate)
      newGameName = ''
      isPrivate = false
      await fetchGames()
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
      joinError = e.message ?? 'Invalid code'
    } finally {
      joining = false
    }
  }

  function copyInviteCode(code: string) {
    navigator.clipboard.writeText(code)
  }

  export let onSelectGame: (game: GameState) => void = () => {}
</script>

<div class="game-list">
  <div class="create-section">
    <div class="create-form">
      <input
        bind:value={newGameName}
        placeholder="New game name..."
        on:keydown={(e) => e.key === 'Enter' && handleCreate()}
      />
      <button class="create-btn" on:click={handleCreate} disabled={creating || !newGameName.trim()}>
        {creating ? 'Creating...' : 'Create Game'}
      </button>
    </div>
    <label class="private-toggle">
      <input type="checkbox" bind:checked={isPrivate} />
      <span class="toggle-track">
        <span class="toggle-thumb"></span>
      </span>
      <span class="toggle-label">Private</span>
    </label>
  </div>

  <div class="join-section">
    <div class="join-form">
      <input
        bind:value={joinCode}
        placeholder="Enter invite code..."
        maxlength="6"
        on:keydown={(e) => e.key === 'Enter' && handleJoin()}
        class="code-input"
      />
      <button class="join-btn" on:click={handleJoin} disabled={joining || !joinCode.trim()}>
        {joining ? 'Joining...' : 'Join Game'}
      </button>
    </div>
    {#if joinError}
      <p class="error" transition:slide={{ duration: 200 }}>{joinError}</p>
    {/if}
  </div>

  <div class="games">
    {#each $games as game (game.id)}
      <div
        class="game-card"
        role="button"
        tabindex="0"
        on:click={() => onSelectGame(game)}
        on:keydown={(e) => e.key === 'Enter' && onSelectGame(game)}
        transition:fly={{ y: 20, duration: 300 }}
        animate:flip={{ duration: 300 }}
      >
        <div class="card-header">
          <h3>{game.name}</h3>
          {#if game.is_private}
            <span class="badge private">Private</span>
          {:else}
            <span class="badge public">Public</span>
          {/if}
        </div>
        <div class="meta">
          <span class="phase">{game.phase}</span>
          <span class="date">{game.season} {game.year}</span>
        </div>
        <div class="card-footer">
          <p class="players">{Object.keys(game.players).length}/7 players</p>
          {#if game.invite_code}
            <button
              class="invite-code"
              on:click|stopPropagation={() => copyInviteCode(game.invite_code ?? '')}
              title="Click to copy"
            >
              {game.invite_code}
            </button>
          {/if}
        </div>
      </div>
    {:else}
      <p class="empty" transition:fade>No games yet. Create one or join with an invite code.</p>
    {/each}
  </div>
</div>

<style>
  .game-list {
    width: 100%;
    max-width: 600px;
    margin: 0 auto;
  }

  .create-section {
    margin-bottom: 16px;
  }

  .create-form {
    display: flex;
    gap: 8px;
  }

  .join-section {
    margin-bottom: 24px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--border, #e2e8f0);
  }

  .join-form {
    display: flex;
    gap: 8px;
  }

  input {
    flex: 1;
    padding: 10px 14px;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    font-size: 14px;
    outline: none;
    transition: border-color 0.15s;
    background: var(--bg-card, white);
    color: var(--text, #2d3748);
  }

  input:focus {
    border-color: #3b82f6;
  }

  .code-input {
    font-family: monospace;
    font-size: 16px;
    letter-spacing: 2px;
    text-transform: uppercase;
    max-width: 160px;
  }

  .create-btn, .join-btn {
    padding: 10px 20px;
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }

  .create-btn {
    background: #3b82f6;
  }

  .create-btn:hover:not(:disabled) {
    background: #2563eb;
  }

  .join-btn {
    background: #6b7280;
  }

  .join-btn:hover:not(:disabled) {
    background: #4b5563;
  }

  .create-btn:disabled, .join-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .private-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    cursor: pointer;
    user-select: none;
  }

  .private-toggle input[type="checkbox"] {
    display: none;
  }

  .toggle-track {
    width: 36px;
    height: 20px;
    background: #cbd5e0;
    border-radius: 10px;
    position: relative;
    transition: background 0.2s;
    flex-shrink: 0;
  }

  .private-toggle input:checked + .toggle-track {
    background: #f59e0b;
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
  }

  .private-toggle input:checked + .toggle-track .toggle-thumb {
    transform: translateX(16px);
  }

  .toggle-label {
    font-size: 13px;
    color: var(--text-muted, #718096);
    font-weight: 500;
  }

  .error {
    color: #e53e3e;
    font-size: 13px;
    margin: 6px 0 0;
  }

  .games {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .game-card {
    display: block;
    width: 100%;
    text-align: left;
    padding: 16px 20px;
    background: var(--bg-card, white);
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 8px;
    cursor: pointer;
    transition: box-shadow 0.2s, transform 0.1s;
  }

  .game-card:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    transform: translateY(-1px);
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .card-header h3 {
    margin: 0;
    font-size: 16px;
    color: var(--text, #1a202c);
  }

  .badge {
    font-size: 11px;
    padding: 1px 7px;
    border-radius: 4px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .badge.private {
    background: #fef3c7;
    color: #92400e;
  }

  .badge.public {
    background: #d1fae5;
    color: #065f46;
  }

  .meta {
    display: flex;
    gap: 12px;
    margin-bottom: 6px;
  }

  .phase {
    font-size: 12px;
    color: white;
    background: #3b82f6;
    padding: 2px 8px;
    border-radius: 4px;
    text-transform: uppercase;
    font-weight: 500;
  }

  .date {
    font-size: 13px;
    color: var(--text-muted, #718096);
  }

  .card-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .players {
    margin: 0;
    font-size: 13px;
    color: #a0aec0;
  }

  .invite-code {
    font-family: monospace;
    font-size: 13px;
    letter-spacing: 1.5px;
    padding: 2px 8px;
    background: #f7fafc;
    border: 1px dashed #cbd5e0;
    border-radius: 4px;
    color: #4a5568;
    cursor: pointer;
    transition: background 0.15s;
  }

  .invite-code:hover {
    background: #edf2f7;
  }

  .empty {
    text-align: center;
    color: #a0aec0;
    padding: 40px;
    font-style: italic;
  }
</style>
