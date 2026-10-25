<script lang="ts">
  // Left rail of the in-game shell: game/sandbox title + back button on top, then the slotted
  // body (chat in a game, unit styles in a sandbox). Mirror of the right order sidebar.
  // On narrow screens it becomes a drawer over the map; the scrim closes it.
  import Icon from './Icon.svelte'

  /** Name shown at the top (game or sandbox name). */
  export let title: string = ''
  /** Leave the game and return to the menu. */
  export let onExit: (() => void) | null = null
  /** Rail width (also caps the drawer width on narrow screens). */
  export let width: string = '320px'
  /** Narrow screens: whether the drawer is open. */
  export let open: boolean = false
  export let onClose: () => void
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="rail-scrim" class:open on:click={onClose}></div>
<aside class="left-rail" class:open style="--rail-width: {width}">
  {#if title || onExit}
    <div class="side-title">
      {#if onExit}
        <button class="glass back" on:click={onExit} title="Back" aria-label="Back">
          <Icon name="back" strokeWidth={2.2} round />
        </button>
      {/if}
      {#if title}<span class="game-name">{title}</span>{/if}
    </div>
  {/if}
  <div class="left-body"><slot /></div>
</aside>

<style>
  .rail-scrim {
    display: none;
  }
  /* Tablets and phones: the rail slides over the map instead of taking a column. */
  @media (max-width: 1100px) {
    .left-rail {
      position: absolute;
      inset: 0 auto 0 0;
      z-index: 40;
      width: min(var(--rail-width, 320px), 86vw);
      transform: translateX(-100%);
      transition: transform 0.2s ease;
      box-shadow: 0 0 32px rgba(0, 0, 0, 0.25);
    }
    .left-rail.open {
      transform: none;
    }
    .rail-scrim.open {
      display: block;
      position: absolute;
      inset: 0;
      z-index: 39;
      background: rgba(0, 0, 0, 0.25);
    }
  }
  /* After the drawer rules, as before the split: at narrow widths this width still wins. */
  .left-rail {
    flex: none;
    width: var(--rail-width, 320px);
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border, #e5e7eb);
    background: var(--bg-card, #fff);
    overflow: hidden;
  }
  .left-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .side-title {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 12px 14px;
    min-height: 52px;
    border-bottom: 1px solid var(--border, #eee);
  }
  .side-title .game-name {
    font-weight: 700;
    font-size: 15px;
    letter-spacing: -0.2px;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    max-width: calc(100% - 180px);
  }
  /* The app's standard back button (see FloatingChrome), pinned to the rail's corner. */
  .side-title .back {
    position: absolute;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: var(--text);
    cursor: pointer;
  }
  .side-title .back:hover {
    border-color: var(--border-strong);
  }
</style>
