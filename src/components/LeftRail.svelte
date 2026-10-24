<script lang="ts">
  // Left rail of the in-game shell: game/sandbox title + Leave on top, then the slotted
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
        <button class="leave" on:click={onExit} title="Leave game">
          <Icon name="back" size={15} strokeWidth={2.2} round />
          Leave
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
  .side-title .leave {
    position: absolute;
    left: 14px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--border-strong, #cbd5e1);
    background: var(--bg-input, #fff);
    color: var(--text-secondary, #555);
    border-radius: 6px;
    padding: 0 10px 0 6px;
    height: 28px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    font-family: var(--font);
    flex: none;
  }
  .side-title .leave:hover {
    border-color: var(--accent, #3b82f6);
    color: var(--accent, #3b82f6);
  }
</style>
