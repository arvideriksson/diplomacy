<script lang="ts">
  // The top bar outside a game: back (off the home page) on the left, the mark in the
  // middle, the user menu on the right.
  import BrandMark from './BrandMark.svelte'
  import UserMenu from './UserMenu.svelte'
  import Icon from './Icon.svelte'

  /** Set off the home page: a back button on the left. */
  export let onBack: (() => void) | null = null
</script>

<header class="home-bar">
  <div class="inner">
    <div class="side">
      {#if onBack}
        <button class="back" type="button" on:click={onBack} title="Back to games" aria-label="Back to games">
          <Icon name="back" strokeWidth={2.2} round />
        </button>
      {/if}
    </div>
    <span class="brand"><BrandMark /><span class="word">Diplomacy</span></span>
    <div class="side end">
      <UserMenu />
    </div>
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
  /* Mark centred between two equal sides, whatever each side holds. */
  .inner {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 12px;
    max-width: 960px;
    height: 56px;
    margin: 0 auto;
    padding: 0 24px;
  }
  .side {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .side.end {
    justify-content: flex-end;
  }
  .back {
    width: 36px;
    height: 36px;
    margin-left: -8px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--text);
    cursor: pointer;
  }
  .back:hover {
    background: var(--bg-hover);
  }
  .brand {
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
  @media (max-width: 600px) {
    .inner {
      padding: 0 16px;
    }
  }
</style>
