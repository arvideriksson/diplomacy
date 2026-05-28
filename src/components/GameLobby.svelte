<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { fade, slide, fly } from 'svelte/transition'
  import { user } from '../lib/auth'
  import {
    fetchGame, updateGame, subscribeToGame, joinGame, leaveGame, kickPlayer,
    currentGame, NATIONS, DEFAULT_SETTINGS,
  } from '../lib/game'
  import type { GameState, GameSettings, PlayerInfo } from '../lib/game'

  export let gameId: string
  export let onBack: () => void = () => {}
  export let onStart: (game: GameState) => void = () => {}

  let game: GameState | null = null
  let loading = true
  let saving = false
  let starting = false
  let copied = false
  let channel: ReturnType<typeof subscribeToGame> | null = null

  let joiningGame = false

  $: isAdmin = game && $user && game.created_by === $user.id
  $: playerCount = game ? Object.keys(game.players).length : 0
  $: isMember = game && $user && !!game.players[$user.id]
  $: canJoin = game && $user && !isMember && playerCount < 7 && game.phase === 'lobby'
  $: canStart = isAdmin && playerCount >= 2 && game?.phase === 'lobby'

  $: settingsName = game?.name ?? ''
  $: settingsTurnTimer = game?.settings?.turn_timer ?? DEFAULT_SETTINGS.turn_timer
  $: settingsVariant = game?.settings?.variant ?? DEFAULT_SETTINGS.variant
  $: settingsSpectators = game?.settings?.allow_spectators ?? DEFAULT_SETTINGS.allow_spectators
  $: settingsRandomNations = game?.settings?.random_nations ?? DEFAULT_SETTINGS.random_nations

  onMount(async () => {
    try {
      game = await fetchGame(gameId)

      channel = subscribeToGame(gameId, (updated) => {
        game = updated
      })
    } finally {
      loading = false
    }
  })

  onDestroy(() => {
    if (channel) {
      channel.unsubscribe()
    }
  })

  async function saveSettings() {
    if (!game || !isAdmin) return
    saving = true
    try {
      const settings: GameSettings = {
        turn_timer: settingsTurnTimer,
        variant: settingsVariant,
        allow_spectators: settingsSpectators,
        random_nations: settingsRandomNations,
      }
      game = await updateGame(gameId, { name: settingsName, settings })
    } finally {
      saving = false
    }
  }

  async function togglePrivate() {
    if (!game || !isAdmin) return
    game = await updateGame(gameId, { is_private: !game.is_private })
  }

  async function handleStartGame() {
    if (!game || !isAdmin) return
    starting = true
    try {
      game = await updateGame(gameId, { phase: 'active' })
      onStart(game)
    } finally {
      starting = false
    }
  }

  async function handleJoin() {
    if (!game || !$user || !canJoin) return
    joiningGame = true
    try {
      game = await joinGame(gameId)
    } finally {
      joiningGame = false
    }
  }

  async function handleLeave() {
    if (!game || !$user) return
    const uid = $user.id
    await leaveGame(gameId)
    const { [uid]: _, ...remaining } = game.players
    game = { ...game, players: remaining }
  }

  async function handleKick(playerId: string) {
    if (!game || !isAdmin) return
    await kickPlayer(gameId, playerId)
    const { [playerId]: _, ...remaining } = game.players
    game = { ...game, players: remaining }
  }

  function copyInviteCode() {
    if (!game?.invite_code) return
    navigator.clipboard.writeText(game.invite_code)
    copied = true
    setTimeout(() => (copied = false), 2000)
  }

  const TURN_TIMER_OPTIONS = [
    { value: '12h', label: '12 hours' },
    { value: '24h', label: '24 hours' },
    { value: '48h', label: '2 days' },
    { value: '72h', label: '3 days' },
    { value: '1w', label: '1 week' },
  ]

  const VARIANT_OPTIONS = [
    { value: 'standard', label: 'Standard', desc: 'Full diplomacy with negotiations' },
    { value: 'gunboat', label: 'Gunboat', desc: 'No communication between players' },
  ]
</script>

{#if loading}
  <div class="loading" transition:fade>
    <div class="spinner"></div>
  </div>
{:else if game}
  <div class="lobby" transition:fade={{ duration: 200 }}>
    <button class="back-btn" on:click={onBack}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
      Games
    </button>

    <div class="lobby-top">
      <div class="lobby-title-row">
        {#if isAdmin}
          <input
            class="title-input"
            bind:value={settingsName}
            on:blur={saveSettings}
            on:keydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            placeholder="Game name"
          />
        {:else}
          <h1>{game.name}</h1>
        {/if}
        <span class="phase-badge">{game.phase}</span>
      </div>
      {#if !isAdmin}
        <p class="admin-note">Only the game creator can change settings.</p>
      {/if}
    </div>

    <div class="lobby-grid">
      <div class="lobby-main">
        <!-- Settings -->
        <section class="card">
          <div class="card-head">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <h2>Game Settings</h2>
          </div>

          <div class="setting-group">
            <span class="setting-label">Turn Timer</span>
            <div class="option-pills">
              {#each TURN_TIMER_OPTIONS as opt}
                <button
                  class="pill"
                  class:active={settingsTurnTimer === opt.value}
                  disabled={!isAdmin}
                  on:click={() => { settingsTurnTimer = opt.value; saveSettings() }}
                >
                  {opt.label}
                </button>
              {/each}
            </div>
          </div>

          <div class="setting-group">
            <span class="setting-label">Game Variant</span>
            <div class="variant-options">
              {#each VARIANT_OPTIONS as opt}
                <button
                  class="variant-card"
                  class:active={settingsVariant === opt.value}
                  disabled={!isAdmin}
                  on:click={() => { settingsVariant = opt.value; saveSettings() }}
                >
                  <span class="variant-name">{opt.label}</span>
                  <span class="variant-desc">{opt.desc}</span>
                </button>
              {/each}
            </div>
          </div>

          <div class="setting-group">
            <div class="toggle-row">
              <div>
                <span class="setting-label">Allow Spectators</span>
                <p class="setting-desc">Non-players can watch the game</p>
              </div>
              <label class="toggle">
                <input type="checkbox" bind:checked={settingsSpectators} disabled={!isAdmin}
                  on:change={saveSettings} />
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </label>
            </div>
          </div>

          <div class="setting-group">
            <div class="toggle-row">
              <div>
                <span class="setting-label">Random Nation Assignment</span>
                <p class="setting-desc">Nations assigned randomly at game start</p>
              </div>
              <label class="toggle">
                <input type="checkbox" bind:checked={settingsRandomNations} disabled={!isAdmin}
                  on:change={saveSettings} />
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </label>
            </div>
          </div>

          <div class="setting-group">
            <div class="toggle-row">
              <div>
                <span class="setting-label">Private</span>
                <p class="setting-desc">{game.is_private ? 'Only invited players can find this game' : 'Anyone can find and join this game'}</p>
              </div>
              <label class="toggle">
                <input type="checkbox" checked={game.is_private} disabled={!isAdmin}
                  on:change={togglePrivate} />
                <span class="toggle-track amber"><span class="toggle-thumb"></span></span>
              </label>
            </div>
          </div>
        </section>
      </div>

      <div class="lobby-sidebar">
        <!-- Invite -->
        {#if game.invite_code}
          <section class="card invite-card">
            <div class="card-head">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              <h2>Invite Players</h2>
            </div>
            <p class="invite-hint">Share this code with friends to join the game.</p>
            <button class="invite-code-display" on:click={copyInviteCode} class:copied>
              <span class="code-text">{game.invite_code}</span>
              {#if copied}
                <span class="copy-label" transition:fade={{ duration: 120 }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Copied
                </span>
              {:else}
                <span class="copy-label">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  Copy
                </span>
              {/if}
            </button>
          </section>
        {/if}

        <!-- Players -->
        <section class="card">
          <div class="card-head">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <h2>Players</h2>
            <span class="player-counter">{playerCount}/7</span>
          </div>

          <div class="player-list">
            {#each Object.entries(game.players) as [uid, player] (uid)}
              {@const info = player}
              <div class="player-row" transition:fly={{ y: 10, duration: 200 }}>
                <div class="player-avatar-wrap">
                  {#if info.avatar_url}
                    <img src={info.avatar_url} alt="" class="player-avatar" />
                  {:else}
                    <div class="player-avatar placeholder">
                      {(info.display_name ?? '?')[0].toUpperCase()}
                    </div>
                  {/if}
                </div>
                <div class="player-info">
                  <span class="player-name">
                    {info.display_name ?? 'Anonymous'}
                    {#if uid === game.created_by}
                      <span class="host-badge">Host</span>
                    {/if}
                  </span>
                  {#if info.nation}
                    <span class="player-nation">{info.nation}</span>
                  {/if}
                </div>
                {#if uid === $user?.id && !isAdmin}
                  <button class="leave-btn" on:click={handleLeave} title="Leave game">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                    </svg>
                  </button>
                {:else if isAdmin && uid !== $user?.id}
                  <button class="kick-btn" on:click={() => handleKick(uid)} title="Remove player">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                {/if}
              </div>
            {/each}

            {#each { length: 7 - playerCount } as _, i}
              <div class="player-row empty-slot">
                <div class="player-avatar-wrap">
                  <div class="player-avatar empty">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </div>
                </div>
                <span class="empty-label">Waiting for player...</span>
              </div>
            {/each}
          </div>
        </section>

        <!-- Actions -->
        <div class="lobby-actions">
          {#if canJoin}
            <button
              class="btn-join"
              disabled={joiningGame}
              on:click={handleJoin}
            >
              {#if joiningGame}
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
            {#if playerCount >= 7}
              <p class="start-hint">Game is full</p>
            {/if}
          {:else if isAdmin}
            <button
              class="btn-start"
              disabled={!canStart || starting}
              on:click={handleStartGame}
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
            {#if !canStart && !starting && playerCount < 2}
              <p class="start-hint">Need at least 2 players to start</p>
            {/if}
          {:else if isMember}
            <p class="waiting-msg">Waiting for host to start the game...</p>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 80px 0;
  }

  .spinner {
    width: 28px;
    height: 28px;
    border: 2.5px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    padding: 4px 0;
    margin-bottom: 20px;
    font-family: var(--font);
    transition: color 0.15s;
  }

  .back-btn:hover {
    color: var(--text);
  }

  .lobby-top {
    margin-bottom: 28px;
  }

  .lobby-title-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .title-input {
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.5px;
    color: var(--text);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 0 0 2px;
    outline: none;
    font-family: var(--font);
    transition: border-color 0.15s;
    flex: 1;
    min-width: 0;
  }

  .title-input:hover {
    border-bottom-color: var(--border);
  }

  .title-input:focus {
    border-bottom-color: var(--accent);
  }

  h1 {
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.5px;
    margin: 0;
    color: var(--text);
  }

  .phase-badge {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 3px 10px;
    border-radius: var(--radius-full);
    background: var(--accent-subtle);
    color: var(--accent);
    flex-shrink: 0;
  }

  .admin-note {
    font-size: 13px;
    color: var(--text-tertiary);
    margin: 6px 0 0;
  }

  .lobby-grid {
    display: grid;
    grid-template-columns: 1fr 340px;
    gap: 20px;
    align-items: start;
  }

  @media (max-width: 768px) {
    .lobby-grid {
      grid-template-columns: 1fr;
    }
  }

  .card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 22px 24px;
  }

  .card + .card {
    margin-top: 12px;
  }

  .card-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 20px;
  }

  .card-head svg {
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .card-head h2 {
    font-size: 15px;
    font-weight: 600;
    margin: 0;
    color: var(--text);
  }

  .player-counter {
    margin-left: auto;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-tertiary);
    background: var(--bg-elevated);
    padding: 2px 8px;
    border-radius: var(--radius-full);
  }

  /* Settings */

  .setting-group {
    padding: 16px 0;
    border-top: 1px solid var(--border);
  }

  .setting-label {
    display: block;
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 4px;
  }

  .setting-desc {
    font-size: 13px;
    color: var(--text-tertiary);
    margin: 0;
  }

  .option-pills {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 8px;
  }

  .pill {
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 500;
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.12s;
    font-family: var(--font);
  }

  .pill:hover:not(:disabled) {
    border-color: var(--border-strong);
  }

  .pill.active {
    background: var(--accent-subtle);
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }

  .pill:disabled {
    cursor: default;
    opacity: 0.65;
  }

  .pill.active:disabled {
    opacity: 1;
  }

  .variant-options {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 8px;
  }

  .variant-card {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 14px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    cursor: pointer;
    text-align: left;
    transition: all 0.12s;
    font-family: var(--font);
  }

  .variant-card:hover:not(:disabled) {
    border-color: var(--border-strong);
  }

  .variant-card.active {
    border-color: var(--accent);
    background: var(--accent-subtle);
  }

  .variant-card:disabled {
    cursor: default;
    opacity: 0.65;
  }

  .variant-card.active:disabled {
    opacity: 1;
  }

  .variant-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
  }

  .variant-desc {
    font-size: 12px;
    color: var(--text-tertiary);
  }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .toggle {
    flex-shrink: 0;
    cursor: pointer;
  }

  .toggle input {
    display: none;
  }

  .toggle-track {
    display: block;
    width: 40px;
    height: 22px;
    background: var(--border-strong);
    border-radius: var(--radius-full);
    position: relative;
    transition: background 0.2s;
  }

  .toggle input:checked + .toggle-track {
    background: var(--accent);
  }

  .toggle input:checked + .toggle-track.amber {
    background: var(--amber);
  }

  .toggle input:disabled + .toggle-track {
    opacity: 0.5;
    cursor: default;
  }

  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    background: white;
    border-radius: 50%;
    transition: transform 0.2s;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  }

  .toggle input:checked + .toggle-track .toggle-thumb {
    transform: translateX(18px);
  }

  /* Invite */

  .invite-card {
    background: var(--accent-subtle);
    border-color: var(--accent-muted);
  }

  .invite-hint {
    font-size: 13px;
    color: var(--text-secondary);
    margin: 0 0 14px;
  }

  .invite-code-display {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 12px 16px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-family: var(--font);
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .invite-code-display:hover {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-subtle);
  }

  .invite-code-display.copied {
    border-color: var(--green);
    box-shadow: 0 0 0 3px var(--green-subtle);
  }

  .code-text {
    font-family: var(--mono);
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 4px;
    color: var(--text);
  }

  .copy-label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-tertiary);
  }

  .copied .copy-label {
    color: var(--green);
  }

  /* Players */

  .player-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .player-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    transition: background 0.12s;
  }

  .player-row:not(.empty-slot):hover {
    background: var(--bg-hover);
  }

  .player-avatar-wrap {
    flex-shrink: 0;
  }

  .player-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    display: block;
  }

  .player-avatar.placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent);
    color: var(--text-inverse);
    font-weight: 600;
    font-size: 13px;
  }

  .player-avatar.empty {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-elevated);
    border: 1px dashed var(--border);
    color: var(--text-tertiary);
  }

  .player-info {
    flex: 1;
    min-width: 0;
  }

  .player-name {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    font-weight: 500;
    color: var(--text);
  }

  .host-badge {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 1px 6px;
    border-radius: var(--radius-full);
    background: var(--amber-subtle);
    color: var(--amber);
  }

  .player-nation {
    display: block;
    font-size: 12px;
    color: var(--text-tertiary);
  }

  .empty-label {
    font-size: 13px;
    color: var(--text-tertiary);
    font-style: italic;
  }

  .leave-btn, .kick-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 5px 8px;
    cursor: pointer;
    color: var(--text-tertiary);
    transition: all 0.12s;
    display: flex;
    align-items: center;
    font-family: var(--font);
  }

  .leave-btn:hover, .kick-btn:hover {
    color: var(--red);
    border-color: var(--red);
    background: var(--red-subtle);
  }

  /* Start Game */

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
