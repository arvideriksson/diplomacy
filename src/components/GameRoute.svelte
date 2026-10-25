<script lang="ts">
  import { onDestroy } from 'svelte'
  import { navigate } from 'svelte-routing'
  import { fetchGame, fetchGames } from '../lib/game'
  import type { GameState } from '../lib/game'
  import { user } from '../lib/auth'
  import { immersive } from '../lib/layout'
  import { errorMessage } from '../lib/errors'
  import GameLobby from './GameLobby.svelte'
  import GameView from './GameView.svelte'
  import StatusPage from './StatusPage.svelte'

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
    } catch (e) {
      game = null
      error = errorMessage(e)
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

  // The list's order status (submitted / not) is from its own fetch — refresh it on the
  // way back so it reflects what was just done in the game.
  function back() {
    navigate('/')
    fetchGames().catch(() => {})
  }

  // Lobby start: flip to the active board in place (route stays /game/:id).
  function onStart(g: GameState) {
    game = g
  }
</script>

{#if loading}
  <StatusPage loading />
{:else if error}
  <StatusPage message={error} actionLabel="Back to games" onAction={back} />
{:else if game && game.phase === 'lobby'}
  <GameLobby gameId={game.id} initialGame={game} onBack={back} {onStart} />
{:else if game}
  <GameView {game} nation={viewerNation} onExit={back} />
{/if}
