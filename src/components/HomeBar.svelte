<script lang="ts">
  // The home screen's top bar: the mark, New game (opens a new game's lobby right away) and the user menu.
  import { navigate } from 'svelte-routing'
  import BrandMark from './BrandMark.svelte'
  import UserMenu from './UserMenu.svelte'
  import Icon from './Icon.svelte'
  import { createGame } from '../lib/game'
  import { user, displayName } from '../lib/auth'
  import { errorMessage } from '../lib/errors'

  let creating = false

  // Straight into the new game's lobby under a placeholder name; the host renames it there.
  async function create() {
    if (!$user || creating) return
    creating = true
    try {
      const first = $displayName?.split(/[\s@]/)[0]
      const game = await createGame(first ? `${first}'s game` : 'New game', $user.id)
      navigate(`/game/${game.id}`)
    } catch (e) {
      alert(errorMessage(e))
    } finally {
      creating = false
    }
  }
</script>

<header class="home-bar">
  <div class="inner">
    <span class="brand"><BrandMark /><span class="word">Diplomacy</span></span>
    <button class="btn btn-primary btn-sm new" type="button" on:click={create} disabled={creating}>
      <Icon name="plus" size={15} strokeWidth={2.4} round />New game
    </button>
    <UserMenu />
  </div>
</header>

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
  @media (max-width: 600px) {
    .inner {
      padding: 0 16px;
    }
  }
</style>
