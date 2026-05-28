<script lang="ts">
  import { onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import { initAuth, isAuthenticated, user } from './lib/auth'
  import { fetchGames } from './lib/game'
  import type { GameState } from './lib/game'
  import LoginButton from './components/LoginButton.svelte'
  import UserMenu from './components/UserMenu.svelte'
  import GameList from './components/GameList.svelte'
  import DiplomacyMap from './components/DiplomacyMap.svelte'
  import type { Unit } from './lib/game'

  let ready = false
  let view: 'lobby' | 'game' = 'lobby'
  let selectedGame: GameState | null = null

  const demoUnits: Unit[] = [
    { type: 'fleet', nation: 'England', territory: 'LON' },
    { type: 'army', nation: 'France', territory: 'PAR' },
    { type: 'army', nation: 'Germany', territory: 'BER' },
    { type: 'army', nation: 'Italy', territory: 'ROM' },
    { type: 'army', nation: 'Austria', territory: 'VIE' },
    { type: 'army', nation: 'Russia', territory: 'MOS' },
    { type: 'army', nation: 'Turkey', territory: 'CON' },
  ]

  onMount(async () => {
    await initAuth()
    ready = true
  })

  async function handleSelectGame(game: GameState) {
    selectedGame = game
    view = 'game'
  }

  function handleBackToLobby() {
    view = 'lobby'
    selectedGame = null
  }

  $: if ($isAuthenticated && ready) {
    fetchGames().catch(() => {})
  }
</script>

{#if !ready}
  <div class="loading" transition:fade>
    <p>Loading...</p>
  </div>
{:else}
  <header>
    <div class="header-inner">
      <button class="logo" on:click={handleBackToLobby}>Diplomacy</button>
      <nav>
        {#if $isAuthenticated}
          <UserMenu />
        {/if}
      </nav>
    </div>
  </header>

  <main>
    {#if !$isAuthenticated}
      <div class="auth-page" transition:fade={{ duration: 300 }}>
        <div class="auth-card">
          <h2>Welcome to Diplomacy</h2>
          <p>The classic game of strategy and negotiation.</p>
          <DiplomacyMap units={demoUnits} />
          <div class="login-container">
            <LoginButton />
          </div>
        </div>
      </div>
    {:else if view === 'lobby'}
      <div class="lobby" transition:fade={{ duration: 200 }}>
        <h2>Your Games</h2>
        <GameList onSelectGame={handleSelectGame} />
      </div>
    {:else if view === 'game' && selectedGame}
      <div class="game-view" transition:fade={{ duration: 200 }}>
        <button class="back-btn" on:click={handleBackToLobby}>&larr; Back to games</button>
        <h2>{selectedGame.name}</h2>
        <p class="game-phase">{selectedGame.season} {selectedGame.year} &mdash; {selectedGame.phase}</p>
        <DiplomacyMap units={selectedGame.units} />
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
    color: var(--text-muted);
  }

  header {
    border-bottom: 1px solid var(--border);
    background: var(--bg-card);
  }

  .header-inner {
    max-width: 960px;
    margin: 0 auto;
    padding: 12px 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .logo {
    font-size: 22px;
    font-weight: 700;
    margin: 0;
    cursor: pointer;
    user-select: none;
    letter-spacing: -0.5px;
    background: none;
    border: none;
    color: var(--text);
    padding: 0;
    font-family: inherit;
  }

  main {
    flex: 1;
    max-width: 960px;
    margin: 0 auto;
    padding: 32px 24px;
    width: 100%;
  }

  .auth-page {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 60vh;
  }

  .auth-card {
    text-align: center;
    max-width: 700px;
  }

  .auth-card h2 {
    font-size: 32px;
    margin: 0 0 8px;
    font-weight: 700;
    letter-spacing: -0.5px;
  }

  .auth-card p {
    color: var(--text-muted);
    margin-bottom: 32px;
    font-size: 17px;
  }

  .login-container {
    display: flex;
    justify-content: center;
    margin-top: 32px;
  }

  .lobby h2 {
    font-size: 24px;
    margin: 0 0 20px;
    font-weight: 600;
  }

  .game-view h2 {
    font-size: 24px;
    margin: 0 0 4px;
    font-weight: 600;
  }

  .game-phase {
    color: var(--text-muted);
    margin-bottom: 24px;
  }

  .back-btn {
    background: none;
    border: none;
    color: var(--accent);
    font-size: 14px;
    cursor: pointer;
    padding: 0;
    margin-bottom: 16px;
  }

  .back-btn:hover {
    text-decoration: underline;
  }
</style>
