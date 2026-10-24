<script lang="ts">
  import { games, createGame, gamesLoaded } from '../lib/game'
  import { user } from '../lib/auth'
  import { sandboxes } from '../lib/sandbox'
  import { maps, getMap } from '../lib/maps'
  import type { GameState } from '../lib/game'
  import type { Sandbox } from '../lib/sandbox'
  import type { Snippet } from 'svelte'
  import { fade } from 'svelte/transition'
  import Modal from './Modal.svelte'

  export let onSelectGame: (game: GameState) => void = () => {}
  export let onOpenSandbox: (id: string) => void = () => {}
  export let onCreateSandbox: (name: string, mapId: string) => void = () => {}

  let newGameName = ''
  let creating = false

  // Maps available for sandboxes, e.g. [['classical', 'Classical'], ['1900', '1900']].
  const mapOptions = Object.entries(maps).map(([id, def]) => [id, def.name] as const)

  // Sandbox-name modal.
  let showNewSandbox = false
  let sandboxName = ''
  let sandboxMapId = 'classical'
  let sandboxInput: HTMLInputElement | undefined

  function openNewSandbox() {
    sandboxName = 'Test game'
    sandboxMapId = 'classical'
    showNewSandbox = true
    // Focus + select the prefilled name once the modal mounts.
    queueMicrotask(() => sandboxInput?.select())
  }

  function confirmNewSandbox() {
    onCreateSandbox(sandboxName.trim() || 'Test game', sandboxMapId)
    showNewSandbox = false
  }

  async function handleCreate() {
    if (!newGameName.trim() || !$user) return
    creating = true
    try {
      const game = await createGame(newGameName.trim(), $user.id)
      newGameName = ''
      onSelectGame(game)
    } finally {
      creating = false
    }
  }

  // Categorize remote games relative to the current player.
  $: joined = (g: GameState) => !!($user && g.players[$user.id])
  $: myGames = $games.filter(joined)
  $: openGames = $games.filter((g) => !joined(g) && g.phase === 'lobby')
  $: runningGames = $games.filter((g) => !joined(g) && g.phase !== 'lobby')
</script>

{#snippet newSandboxButton()}
  <button class="header-btn" on:click|preventDefault|stopPropagation={openNewSandbox}>+ New sandbox</button>
{/snippet}

<!-- A collapsible list section: title and count, an optional header action, then the cards. -->
{#snippet section<T extends { id: string }>(title: string, items: T[], emptyText: string, card: Snippet<[T]>, action?: Snippet)}
  <details class="section" open>
    <summary>
      <svg class="chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 18l6-6-6-6" />
      </svg>
      <span class="section-title">{title}</span>
      <span class="count">{items.length}</span>
      {#if action}{@render action()}{/if}
    </summary>
    <div class="section-body">
      {#if items.length === 0}
        <p class="empty-line">{emptyText}</p>
      {:else}
        <div class="games">
          {#each items as item (item.id)}
            {@render card(item)}
          {/each}
        </div>
      {/if}
    </div>
  </details>
{/snippet}

{#snippet gameCard(game: GameState)}
  <div
    class="game-card"
    role="button"
    tabindex="0"
    on:click={() => onSelectGame(game)}
    on:keydown={(e) => e.key === 'Enter' && onSelectGame(game)}
    transition:fade={{ duration: 200 }}
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
        {#if game.map_id && game.map_id !== 'classical'}<span class="phase-pill">{maps[game.map_id]?.name ?? game.map_id}</span>{/if}
        <span class="season">{game.season} {game.year}</span>
        <span class="player-count">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          {Object.keys(game.players).length}/{getMap(game.map_id ?? 'classical').powers.length}
        </span>
      </div>
    </div>
    <svg class="card-arrow" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M9 18l6-6-6-6" />
    </svg>
  </div>
{/snippet}

{#snippet sandboxCard(s: Sandbox)}
  <div
    class="game-card"
    role="button"
    tabindex="0"
    on:click={() => onOpenSandbox(s.id)}
    on:keydown={(e) => e.key === 'Enter' && onOpenSandbox(s.id)}
    transition:fade={{ duration: 200 }}
  >
    <div class="card-left">
      <div class="card-title-row">
        <h3>{s.name}</h3>
        <span class="visibility-badge sandbox">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M3 3v18h18" />
            <path d="M7 14l4-4 3 3 5-5" />
          </svg>
          Sandbox
        </span>
      </div>
      <div class="card-meta">
        <span class="phase-pill">{s.frames[s.cursor].board.phase}</span>
        <span class="season">{s.frames[s.cursor].board.season} {s.frames[s.cursor].board.year}</span>
      </div>
    </div>
    <svg class="card-arrow" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M9 18l6-6-6-6" />
    </svg>
  </div>
{/snippet}

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
      <p class="action-hint">Got an invite link from a friend? Just open it to join.</p>
    </div>
  </div>

  {#if $gamesLoaded}
    {@render section('My games', myGames, 'You haven’t joined any games yet.', gameCard)}
    {@render section('Sandboxes', $sandboxes, 'Create a sandbox to try the rules — you control every power and resolve turns instantly.', sandboxCard, newSandboxButton)}
    {@render section('Open games', openGames, 'No open games right now.', gameCard)}
    {@render section('Running games', runningGames, 'No games in progress.', gameCard)}
  {/if}
</div>

{#if showNewSandbox}
  <Modal title="New sandbox" onClose={() => (showNewSandbox = false)} maxWidth={420} top={96}>
    <p class="modal-desc">A local game where you control every power and resolve turns instantly.</p>
    <label class="field-label" for="sandbox-name">Name</label>
    <input
      id="sandbox-name"
      bind:this={sandboxInput}
      bind:value={sandboxName}
      class="name-input"
      placeholder="Sandbox name"
      on:keydown={(e) => {
        if (e.key === 'Enter') confirmNewSandbox()
        else if (e.key === 'Escape') showNewSandbox = false
      }}
    />
    <label class="field-label" for="sandbox-map">Map</label>
    <div class="select-wrap">
      <select id="sandbox-map" bind:value={sandboxMapId} class="map-select">
        {#each mapOptions as [id, label] (id)}
          <option value={id}>{label}</option>
        {/each}
      </select>
      <svg class="select-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" on:click={() => (showNewSandbox = false)}>Cancel</button>
      <button class="btn btn-primary" on:click={confirmNewSandbox} disabled={!sandboxName.trim()}>
        Create sandbox
      </button>
    </div>
  </Modal>
{/if}

<style>
  .game-list {
    width: 100%;
  }

  .actions-row {
    margin-bottom: 28px;
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

  .action-hint {
    font-size: 13px;
    color: var(--text-tertiary);
    margin: 12px 0 0;
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

  /* Collapsible section dividers. */
  .section {
    border-top: 1px solid var(--border);
  }

  .section summary {
    list-style: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 4px;
    cursor: pointer;
    user-select: none;
    outline: none;
  }

  .section summary::-webkit-details-marker {
    display: none;
  }

  .section summary:focus-visible {
    box-shadow: 0 0 0 3px var(--accent-subtle);
    border-radius: var(--radius-sm);
  }

  .chevron {
    color: var(--text-tertiary);
    flex-shrink: 0;
    transition: transform 0.18s ease;
  }

  .section[open] .chevron {
    transform: rotate(90deg);
  }

  .section-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.2px;
  }

  .count {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-tertiary);
    background: var(--bg-input);
    border-radius: var(--radius-full);
    padding: 1px 9px;
    min-width: 20px;
    text-align: center;
  }

  .header-btn {
    margin-left: auto;
    padding: 5px 12px;
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--text-inverse);
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    font-family: var(--font);
    transition: background 0.12s;
  }

  .header-btn:hover {
    background: var(--accent-hover);
  }

  .section-body {
    padding: 0 0 16px;
  }

  .empty-line {
    margin: 0;
    padding: 4px 4px 8px;
    font-size: 13px;
    color: var(--text-tertiary);
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

  .visibility-badge.sandbox {
    background: var(--accent-subtle);
    color: var(--accent);
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

  .modal-desc {
    margin: 0 0 16px;
    font-size: 13px;
    color: var(--text-tertiary);
  }

  .name-input {
    width: 100%;
    padding: 9px 13px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 14px;
    outline: none;
    background: var(--bg-input);
    color: var(--text);
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .name-input::placeholder {
    color: var(--text-tertiary);
  }

  .name-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-subtle);
  }

  .field-label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 14px 0 6px;
  }

  .field-label:first-of-type {
    margin-top: 0;
  }

  .select-wrap {
    position: relative;
  }

  .map-select {
    width: 100%;
    padding: 9px 36px 9px 13px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 14px;
    font-family: var(--font);
    outline: none;
    background: var(--bg-input);
    color: var(--text);
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .map-select:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-subtle);
  }

  .select-chevron {
    position: absolute;
    right: 11px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-tertiary);
    pointer-events: none;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
  }

  .btn-ghost {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border);
  }

  .btn-ghost:hover {
    background: var(--bg-input);
    border-color: var(--border-strong);
  }
</style>
