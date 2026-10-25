<script lang="ts">
  // A small ⓘ next to a setting that shows its explanation on hover / focus / tap, in
  // place of a subtitle. The bubble is position: fixed, placed on open, so the card or
  // modal it sits in can't clip it.
  export let text: string

  let anchor: HTMLButtonElement
  let open = false
  let x = 0
  let y = 0
  let below = false

  const WIDTH = 240
  const GAP = 8

  // A touch tap fires focus (→ show) and then click; ignore a click that lands right
  // after the bubble opened so the tap opens it rather than toggling it shut.
  let shownAt = 0

  function show() {
    shownAt = Date.now()
    const r = anchor.getBoundingClientRect()
    x = Math.min(Math.max(r.left + r.width / 2 - WIDTH / 2, 8), window.innerWidth - WIDTH - 8)
    // Prefer above; flip below when there isn't room near the top of the viewport.
    below = r.top < 96
    y = below ? r.bottom + GAP : r.top - GAP
    open = true
  }
  const hide = () => (open = false)
</script>

<svelte:window on:scroll|capture={hide} on:resize={hide} />

<button
  type="button"
  class="info"
  bind:this={anchor}
  aria-label={text}
  on:pointerenter={(e) => e.pointerType === 'mouse' && show()}
  on:pointerleave={(e) => e.pointerType === 'mouse' && hide()}
  on:focus={show}
  on:blur={hide}
  on:click|preventDefault|stopPropagation={() => (open && Date.now() - shownAt > 400 ? hide() : show())}
>
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="11" x2="12" y2="16" />
    <circle cx="12" cy="7.5" r="0.5" fill="currentColor" />
  </svg>
</button>

{#if open}
  <span class="bubble" class:below role="tooltip" style="left: {x}px; top: {y}px; width: {WIDTH}px">{text}</span>
{/if}

<style>
  .info {
    display: inline-flex;
    align-items: center;
    vertical-align: -2px;
    /* 14px glyph, ~26px hit area: the padding is cancelled by negative margins. */
    margin: -6px -6px -6px -1px;
    padding: 6px;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: help;
    border-radius: 50%;
  }
  .info:hover,
  .info:focus-visible {
    color: var(--text-secondary);
    outline: none;
  }

  .bubble {
    position: fixed;
    z-index: 2000;
    transform: translateY(-100%);
    padding: 7px 10px;
    font-size: 12px;
    font-weight: 400;
    line-height: 1.4;
    text-transform: none;
    letter-spacing: normal;
    color: var(--text-inverse);
    background: var(--text);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-md);
    pointer-events: none;
  }
  .bubble.below {
    transform: none;
  }
</style>
