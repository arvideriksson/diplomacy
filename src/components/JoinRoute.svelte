<script lang="ts">
  import { onMount } from 'svelte'
  import { navigate } from 'svelte-routing'
  import { joinGame, fetchGames } from '../lib/game'
  import { errorMessage } from '../lib/errors'
  import StatusPage from './StatusPage.svelte'

  // The :id param is the game id — the unguessable UUID is the invite token.
  export let id: string

  let error = ''

  // App only renders routes once authenticated, so by the time this mounts the
  // user is signed in — join the game, then drop them into it.
  onMount(async () => {
    try {
      await joinGame(id)
      await fetchGames().catch(() => {})
      navigate(`/game/${id}`, { replace: true })
    } catch (e) {
      error = errorMessage(e)
    }
  })
</script>

{#if error}
  <StatusPage message={error} actionLabel="Back to games" onAction={() => navigate('/')} />
{:else}
  <StatusPage loading message="Joining game…" />
{/if}
