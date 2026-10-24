<script lang="ts">
  import { onDestroy } from 'svelte'
  import { navigate } from 'svelte-routing'
  import { fetchGame } from '../lib/game'
  import type { GameState } from '../lib/game'
  import { user } from '../lib/auth'
  import { immersive } from '../lib/layout'
  import GameLobby from './GameLobby.svelte'
  import GameView from './GameView.svelte'

  export let id: string

  let game: GameState | null = null
  let loading = true
  let error = ''

  // Reload whenever the route id changes (e.g. navigating between games).
  $: load(id)

  async function load(gameId: string) {
    loading = true
    error = ''
    try {
      game = await fetchGame(gameId)
    } catch (e: any) {
      game = null
      error = e?.message ?? 'Game not found'
    } finally {
      loading = false
    }
  }

  // Active games go full-screen; the lobby keeps the floating back button and user menu.
  $: immersive.set(!!game && game.phase !== 'lobby')
  onDestroy(() => {
    immersive.set(false)
  })

  $: viewerNation = game && $user ? game.players[$user.id]?.nation ?? '' : ''

  function back() {
    navigate('/')
  }

  // Lobby start: flip to the active board in place (route stays /game/:id).
  function onStart(g: GameState) {
    game = g
  }
</script>

{#if loading}
  <div class="route-status"><div class="spinner"></div></div>
{:else if error}
  <div class="route-status">
    <p>{error}</p>
    <button class="btn" on:click={back}>Back to games</button>
  </div>
{:else if game && game.phase === 'lobby'}
  <GameLobby gameId={game.id} initialGame={game} onBack={back} {onStart} />
{:else if game}
  <GameView {game} nation={viewerNation} onExit={back} />
{/if}

<style>
  .route-status {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 80px 24px;
    color: var(--text-secondary, #777);
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
  .btn {
    padding: 8px 16px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-card, #fff);
    color: var(--text, #1a1a1a);
    cursor: pointer;
  }
</style>
