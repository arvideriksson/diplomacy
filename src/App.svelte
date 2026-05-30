<script lang="ts">
  import { onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import { initAuth, isAuthenticated, isSiteAdmin, user } from './lib/auth'
  import { fetchGames } from './lib/game'
  import type { GameState } from './lib/game'
  import LoginButton from './components/LoginButton.svelte'
  import UserMenu from './components/UserMenu.svelte'
  import GameList from './components/GameList.svelte'
  import GameLobby from './components/GameLobby.svelte'
  import DiplomacyMap from './components/DiplomacyMap.svelte'
  import AdminPanel from './components/AdminPanel.svelte'
  import type { Unit } from './lib/game'
  import { standardMap } from './lib/maps/standard'

  let ready = false
  let view: 'list' | 'game-lobby' | 'game' | 'map-editor' = 'list'
  let selectedGame: GameState | null = null

  const demoUnits: Unit[] = standardMap.startingUnits.map((u) => ({
    type: u.type,
    nation: u.power,
    territory: u.territory,
  }))

  // Starting political map: home supply centers tinted by their owning power.
  const homeOwnership: Record<string, string> = Object.fromEntries(
    Object.entries(standardMap.territories)
      .filter(([, t]) => t.supplyCenter && t.homePower)
      .map(([id, t]) => [id, t.homePower as string])
  )

  onMount(async () => {
    await initAuth()
    ready = true
  })

  function handleSelectGame(game: GameState) {
    selectedGame = game
    view = game.phase === 'lobby' ? 'game-lobby' : 'game'
  }

  function handleGameStarted(game: GameState) {
    selectedGame = game
    view = 'game'
  }

  // Tint supply-center provinces by the nation currently occupying them.
  $: gameOwnership = selectedGame
    ? Object.fromEntries(
        selectedGame.units
          .filter((u) => standardMap.territories[u.territory]?.supplyCenter)
          .map((u) => [u.territory, u.nation])
      )
    : {}

  function handleBackToList() {
    view = 'list'
    selectedGame = null
    fetchGames().catch(() => {})
  }

  $: if ($isAuthenticated && ready) {
    fetchGames().catch(() => {})
  }
</script>

{#if !ready}
  <div class="loading">
    <div class="spinner"></div>
  </div>
{:else}
  <header>
    <div class="header-inner">
      <button class="logo" on:click={handleBackToList}>
        <svg viewBox="0 0 512 512" width="22" height="22" fill="currentColor" aria-hidden="true">
          <!-- Font Awesome Free 6.7.2 - CC BY 4.0 - fontawesome.com -->
          <path d="M160.8 96.5c14 17 31 30.9 49.5 42.2c25.9 15.8 53.7 25.9 77.7 31.6l0-31.5C265.8 108.5 250 71.5 248.6 28c-.4-11.3-7.5-21.5-18.4-24.4c-7.6-2-15.8-.2-21 5.8c-13.3 15.4-32.7 44.6-48.4 87.2zM320 144l0 30.6s0 0 0 0l0 1.3s0 0 0 0l0 32.1c-60.8-5.1-185-43.8-219.3-157.2C97.4 40 87.9 32 76.6 32c-7.9 0-15.3 3.9-18.8 11C46.8 65.9 32 112.1 32 176c0 116.9 80.1 180.5 118.4 202.8L11.8 416.6C6.7 418 2.6 421.8 .9 426.8s-.8 10.6 2.3 14.8C21.7 466.2 77.3 512 160 512c3.6 0 7.2-1.2 10-3.5L245.6 448l74.4 0c88.4 0 160-71.6 160-160l0-160 29.9-44.9c1.3-2 2.1-4.4 2.1-6.8c0-6.8-5.5-12.3-12.3-12.3L400 64c-44.2 0-80 35.8-80 80zm80-16a16 16 0 1 1 0 32 16 16 0 1 1 0-32z"/>
        </svg>
        Diplomacy
      </button>
      <nav>
        {#if $isAuthenticated}
          <UserMenu />
        {/if}
      </nav>
    </div>
  </header>

  <main>
    {#if !$isAuthenticated}
      <div class="auth-page" in:fade={{ duration: 200 }}>
        <div class="auth-card">
          <div class="auth-hero">
            <h1>Diplomacy</h1>
            <p>The classic game of strategy, negotiation, and betrayal.</p>
          </div>
          <DiplomacyMap mapDef={standardMap} units={demoUnits} ownership={homeOwnership} interactive={false} />
          <div class="login-container">
            <LoginButton />
            <p class="login-hint">Sign in to create or join games</p>
          </div>
        </div>
      </div>
    {:else if view === 'list'}
      <div class="list-view">
        {#if $isSiteAdmin}
          <AdminPanel on:openMapEditor={() => view = 'map-editor'} />
        {/if}
        <GameList onSelectGame={handleSelectGame} />
      </div>
    {:else if view === 'map-editor'}
      <div class="game-view">
        <button class="back-btn" on:click={handleBackToList}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <div class="game-header">
          <h2>Map Editor</h2>
          <span class="game-meta">Standard — 1901</span>
        </div>
        <DiplomacyMap mapDef={standardMap} units={demoUnits} />
      </div>
    {:else if view === 'game-lobby' && selectedGame}
      <div>
        <GameLobby
          gameId={selectedGame.id}
          initialGame={selectedGame}
          onBack={handleBackToList}
          onStart={handleGameStarted}
        />
      </div>
    {:else if view === 'game' && selectedGame}
      <div class="game-view">
        <button class="back-btn" on:click={handleBackToList}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Games
        </button>
        <div class="game-header">
          <h2>{selectedGame.name}</h2>
          <span class="game-meta">{selectedGame.season} {selectedGame.year}</span>
          <span class="game-phase-pill">{selectedGame.phase}</span>
        </div>
        <DiplomacyMap mapDef={standardMap} units={selectedGame.units} ownership={gameOwnership} />
      </div>
    {/if}
  </main>
{/if}

<style>
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
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

  header {
    position: sticky;
    top: 0;
    z-index: 50;
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    backdrop-filter: blur(16px) saturate(1.5);
    -webkit-backdrop-filter: blur(16px) saturate(1.5);
    border-bottom: 1px solid var(--border);
  }

  .header-inner {
    max-width: 960px;
    margin: 0 auto;
    padding: 0 24px;
    height: 56px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 17px;
    font-weight: 700;
    letter-spacing: -0.3px;
    color: var(--text);
    background: none;
    border: none;
    padding: 6px 0;
    cursor: pointer;
    font-family: var(--font);
  }

  .logo svg {
    color: #3b82f6;
  }

  main {
    flex: 1;
    max-width: 960px;
    margin: 0 auto;
    padding: 32px 24px 64px;
    width: 100%;
  }

  .auth-page {
    display: flex;
    justify-content: center;
    padding-top: 40px;
  }

  .auth-card {
    text-align: center;
    max-width: 680px;
    width: 100%;
  }

  .auth-hero h1 {
    font-size: 44px;
    font-weight: 700;
    margin: 0 0 8px;
    letter-spacing: -1.5px;
    color: var(--text);
  }

  .auth-hero p {
    color: var(--text-secondary);
    margin: 0 0 40px;
    font-size: 17px;
  }

  .login-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    margin-top: 36px;
  }

  .login-hint {
    font-size: 13px;
    color: var(--text-tertiary);
    margin: 0;
  }

.game-view h2 {
    font-size: 22px;
    margin: 0;
    font-weight: 700;
    letter-spacing: -0.3px;
  }

  .game-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 24px;
    flex-wrap: wrap;
  }

  .game-meta {
    color: var(--text-tertiary);
    font-size: 14px;
  }

  .game-phase-pill {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 3px 10px;
    border-radius: var(--radius-full);
    background: var(--accent-subtle);
    color: var(--accent);
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
</style>
