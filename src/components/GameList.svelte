<script lang="ts">
  import { fade } from 'svelte/transition'
  import { games, createGame, gamesLoaded } from '../lib/game'
  import { user } from '../lib/auth'
  import { sandboxes } from '../lib/sandbox'
  import { maps, getMap } from '../lib/maps'
  import type { GameState } from '../lib/game'
  import type { Sandbox } from '../lib/sandbox'
  import type { Snippet } from 'svelte'
  import Modal from './Modal.svelte'
  import Icon from './Icon.svelte'

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

<!-- Shared card shell: a clickable row with a title, a badge, a meta line and an arrow. -->
{#snippet listCard(onOpen: () => void, title: string, badge: Snippet, meta: Snippet)}
  <div
    class="game-card"
    role="button"
    tabindex="0"
    on:click={onOpen}
    on:keydown={(e) => e.key === 'Enter' && onOpen()}
    transition:fade={{ duration: 200 }}
  >
    <div class="card-left">
      <div class="card-title-row">
        <h3>{title}</h3>
        {@render badge()}
      </div>
      <div class="card-meta">
        {@render meta()}
      </div>
    </div>
    <span class="card-arrow"><Icon name="chevron-right" /></span>
  </div>
{/snippet}

{#snippet gameCard(game: GameState)}
  {#snippet badge()}
    {#if game.is_private}
      <span class="badge badge-amber">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        Private
      </span>
    {:else}
      <span class="badge badge-green">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20" />
        </svg>
        Public
      </span>
    {/if}
  {/snippet}
  {#snippet meta()}
    <span class="badge badge-caps">{game.phase}</span>
    {#if game.map_id && game.map_id !== 'classical'}<span class="badge badge-caps">{maps[game.map_id]?.name ?? game.map_id}</span>{/if}
    <span class="season">{game.season} {game.year}</span>
    <span class="player-count">
      <Icon name="users" size={14} />
      {Object.keys(game.players).length}/{getMap(game.map_id).powers.length}
    </span>
  {/snippet}
  {@render listCard(() => onSelectGame(game), game.name, badge, meta)}
{/snippet}

{#snippet sandboxCard(s: Sandbox)}
  {#snippet badge()}
    <span class="badge">
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M3 3v18h18" />
        <path d="M7 14l4-4 3 3 5-5" />
      </svg>
      Sandbox
    </span>
  {/snippet}
  {#snippet meta()}
    <span class="badge badge-caps">{s.frames[s.cursor].board.phase}</span>
    <span class="season">{s.frames[s.cursor].board.season} {s.frames[s.cursor].board.year}</span>
  {/snippet}
  {@render listCard(() => onOpenSandbox(s.id), s.name, badge, meta)}
{/snippet}

<!-- A collapsible section of cards (games or sandboxes), with an optional header action. -->
{#snippet section(title: string, items: Array<GameState | Sandbox>, emptyText: string, action?: Snippet)}
  <details class="section" open>
    <summary>
      <span class="chevron"><Icon name="chevron-right" size={16} /></span>
      <span class="section-title">{title}</span>
      <span class="count">{items.length}</span>
      {@render action?.()}
    </summary>
    <div class="section-body">
      {#if items.length === 0}
        <p class="empty-line">{emptyText}</p>
      {:else}
        <div class="games">
          {#each items as item (item.id)}
            {#if 'frames' in item}
              {@render sandboxCard(item)}
            {:else}
              {@render gameCard(item)}
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  </details>
{/snippet}

{#snippet newSandboxButton()}
  <button class="btn btn-primary btn-sm header-btn" on:click|preventDefault|stopPropagation={openNewSandbox}>+ New sandbox</button>
{/snippet}

<div class="game-list">
  <div class="actions-row">
    <div class="card action-card">
      <div class="action-label">Create a new game</div>
      <div class="action-form">
        <input
          class="input"
          bind:value={newGameName}
          placeholder="Game name"
          on:keydown={(e) => e.key === 'Enter' && handleCreate()}
        />
        <button class="btn btn-primary" on:click={handleCreate} disabled={creating || !newGameName.trim()}>
          {creating ? 'Creating...' : 'Create'}
        </button>
      </div>
    </div>
  </div>

  {#if $gamesLoaded}
    {@render section('My games', myGames, 'You haven’t joined any games yet.')}
    {@render section('Sandboxes', $sandboxes, 'Create a sandbox to try the rules — you control every power and resolve turns instantly.', newSandboxButton)}
    {@render section('Open games', openGames, 'No open games right now.')}
    {@render section('Running games', runningGames, 'No games in progress.')}
  {/if}
</div>

{#if showNewSandbox}
  <Modal title="New sandbox" top="96px" onClose={() => (showNewSandbox = false)}>
    <label class="field-label" for="sandbox-name">Name</label>
    <input
      id="sandbox-name"
      bind:this={sandboxInput}
      bind:value={sandboxName}
      class="input"
      placeholder="Sandbox name"
      on:keydown={(e) => e.key === 'Enter' && confirmNewSandbox()}
    />
    <label class="field-label" for="sandbox-map">Map</label>
    <div class="select-wrap">
      <select id="sandbox-map" bind:value={sandboxMapId} class="input map-select">
        {#each mapOptions as [id, label] (id)}
          <option value={id}>{label}</option>
        {/each}
      </select>
      <span class="select-chevron"><Icon name="chevron-down" size={16} /></span>
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

  .action-form .input {
    flex: 1;
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
    display: flex;
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

  .card-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
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
    display: flex;
    color: var(--text-tertiary);
    flex-shrink: 0;
    transition: transform 0.15s;
  }

  .game-card:hover .card-arrow {
    transform: translateX(2px);
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
    padding-right: 36px;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
  }

  .select-chevron {
    display: flex;
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
</style>
