<script lang="ts">
  import { onMount } from 'svelte'
  import { navigate } from 'svelte-routing'
  import { joinGame, fetchGames } from '../lib/game'

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
    } catch (e: any) {
      error = e?.message ?? 'This invite link is invalid or the game has already started.'
    }
  })
</script>

<div class="join-status">
  {#if error}
    <p>{error}</p>
    <button class="btn" on:click={() => navigate('/')}>Back to games</button>
  {:else}
    <div class="spinner"></div>
    <p>Joining game…</p>
  {/if}
</div>

<style>
  .join-status {
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
