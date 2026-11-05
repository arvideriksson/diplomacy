<script lang="ts">
  // The home screen's top bar: the mark, New game (asks for a name, then opens the new
  // game's lobby) and the user menu.
  import { navigate } from 'svelte-routing'
  import BrandMark from './BrandMark.svelte'
  import UserMenu from './UserMenu.svelte'
  import Modal from './Modal.svelte'
  import Icon from './Icon.svelte'
  import { createGame } from '../lib/game'
  import { user } from '../lib/auth'
  import { errorMessage } from '../lib/errors'

  let open = false
  let name = ''
  let creating = false
  let error = ''
  let input: HTMLInputElement | undefined

  function start() {
    name = ''
    error = ''
    open = true
    queueMicrotask(() => input?.focus())
  }

  async function create() {
    if (!name.trim() || !$user || creating) return
    creating = true
    error = ''
    try {
      const game = await createGame(name.trim(), $user.id)
      open = false
      navigate(`/game/${game.id}`)
    } catch (e) {
      error = errorMessage(e)
    } finally {
      creating = false
    }
  }
</script>

<header class="home-bar">
  <div class="inner">
    <span class="brand"><BrandMark /><span class="word">Diplomacy</span></span>
    <button class="btn btn-primary btn-sm new" type="button" on:click={start}>
      <Icon name="plus" size={15} strokeWidth={2.4} round />New game
    </button>
    <UserMenu />
  </div>
</header>

{#if open}
  <Modal title="New game" top="96px" onClose={() => (open = false)}>
    <form on:submit|preventDefault={create}>
      <label class="label" for="new-game-name">Name</label>
      <input id="new-game-name" bind:this={input} bind:value={name} class="input" autocomplete="off" />
      {#if error}<p class="err">{error}</p>{/if}
      <div class="actions">
        <button class="btn btn-ghost" type="button" on:click={() => (open = false)}>Cancel</button>
        <button class="btn btn-primary" type="submit" disabled={!name.trim() || creating}>
          {creating ? 'Creating…' : 'Create'}
        </button>
      </div>
    </form>
  </Modal>
{/if}

<style>
  /* As wide as the content column below (App's main: 960px), so on wide screens the
     side art runs up past it to the top of the window. */
  .home-bar {
    position: relative;
    z-index: 40;
    width: 100%;
    max-width: 960px;
    margin: 0 auto;
    padding-top: env(safe-area-inset-top);
    background: var(--bg-card);
    border-bottom: 1px solid var(--border);
  }
  /* 24px gutters, lined up with the list below. */
  .inner {
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 960px;
    height: 56px;
    margin: 0 auto;
    padding: 0 24px;
  }
  .brand {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }
  .word {
    font-family: var(--font-display);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 2.6px;
    text-transform: uppercase;
    color: var(--text);
  }
  .new {
    gap: 6px;
    height: 34px;
  }
  .label {
    display: block;
    margin: 0 0 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
  }
  .err {
    margin: 8px 0 0;
    font-size: 12.5px;
    color: var(--red);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
  }
  @media (max-width: 600px) {
    .inner {
      padding: 0 16px;
    }
    .actions .btn {
      flex: 1;
    }
  }
</style>
