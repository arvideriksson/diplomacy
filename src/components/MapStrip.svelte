<script lang="ts">
  // The slim glass bar at the foot of the map (phones always, desktop while the order
  // sidebar is hidden): what's left to order as text, one button (Submit, Resubmit, …) on
  // the right. With `onLatest`, the past-phase variant: a way back to the live phase.
  import Icon from './Icon.svelte'

  /** History: jump back to the live phase (renders the past-phase bar instead). */
  export let onLatest: (() => void) | null = null
  /** Nothing to say: just the button, its backdrop shrunk to fit. */
  export let bare = false
  /** Nothing to order this phase: the status alone, no button. */
  export let idle = false
  /** Retreats / builds / removals still to order, and whether "Next ›" can pick one. */
  export let adjust: { text: string; next: boolean } | null = null
  export let onNextAdjust: () => void = () => {}
  /** Sandbox: a running count instead of the next unit, and an amber Resolve. */
  export let sandbox = false
  export let count = ''
  /** Edits to a submitted set, not yet resubmitted. */
  export let unsent = false
  /** The next un-ordered unit's province, and how many more follow it. */
  export let nextUnit = ''
  export let moreUnits = 0
  export let onNextUnit: () => void = () => {}
  /** Shown when there's nothing else to say. */
  export let message = ''
  export let label = ''
  export let resubmit = false
  /** Something still to order: yellow until it's all in (submitting asks first). */
  export let incomplete = false
  export let disabled = false
  export let onSubmit: () => void = () => {}
</script>

{#if onLatest}
  <div class="glass strip">
    <div class="strip-info"><span>Viewing a past phase</span></div>
    <button class="strip-submit plain" on:click={onLatest}>Back to now ›</button>
  </div>
{:else}
  <div class="glass strip" class:bare class:done-strip={idle}>
    {#if !bare}
    <div class="strip-info">
      {#if adjust?.next}
        <button class="strip-next" on:click={onNextAdjust}>
          <span class="dot"></span>{adjust.text}
          <span class="next">Next ›</span>
        </button>
      {:else if adjust}
        <span class="strip-next"><span class="dot"></span>{adjust.text}</span>
      {:else if sandbox}
        <span class="strip-count">{count}</span>
      {:else if unsent}
        <span class="unsent">Unsent changes</span>
      {:else if idle}
        <span class="strip-done">
          <Icon name="check" strokeWidth={2.6} round />
          <strong>{label}</strong>
        </span>
      {:else if nextUnit}
        <button class="strip-go" on:click={onNextUnit}>
          <span class="dot"></span>
          Order {nextUnit}
          {#if moreUnits > 0}<span class="more">+{moreUnits}</span>{/if}
          <span class="next">›</span>
        </button>
      {:else}
        <span>{message}</span>
      {/if}
    </div>
    {/if}
    {#if idle}
      <!-- Nothing to order: the status alone, no button. -->
    {:else}
    <button
        class="strip-submit"
        class:sandbox
        class:resubmit
        class:incomplete
        {disabled}
        on:click={onSubmit}
      >
        {label}
      </button>
    {/if}
  </div>
{/if}

<style>
  /* A slim floater sized to its content and centred: status / next unit as text, one
     button (Submit, Resubmit, …) on the right. */
  .strip {
    display: flex;
    align-items: center;
    gap: 14px;
    max-width: 100%;
    padding: 6px 6px 6px 16px;
    border-radius: 16px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
  }
  /* Nothing to press (nothing to order): just the status. */
  .strip.done-strip:not(:has(button)) {
    min-height: 52px;
    padding: 6px 18px;
  }
  .strip.bare {
    padding: 6px;
  }
  .strip-info {
    flex: 0 1 auto;
    min-width: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
  }
  .strip-info .unsent {
    color: var(--accent);
  }
  .strip-next {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    min-height: 40px;
    padding: 0;
    border: none;
    background: none;
    color: var(--text);
    font: 600 13px var(--font);
    cursor: pointer;
  }
  span.strip-next {
    cursor: default;
  }
  .strip-next .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--amber);
    flex: none;
  }
  .strip-go {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    height: 40px;
    padding: 0;
    border: none;
    background: none;
    color: var(--text);
    font: 700 15px var(--font);
    white-space: nowrap;
    cursor: pointer;
  }
  .strip-go:hover .next {
    color: var(--accent);
  }
  .strip-go .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--amber);
  }
  .strip-go .more {
    color: var(--text-secondary);
    font-weight: 600;
  }
  .strip-go .next {
    color: inherit;
    font-size: 16px;
  }
  .strip-count {
    color: var(--text);
    font-size: 15px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .strip-done {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--green);
  }
  .strip-done :global(svg) {
    flex: none;
  }
  .strip-done strong {
    color: var(--text);
    font-size: 14px;
  }
  .strip-next .next {
    color: var(--accent);
    font-weight: 700;
  }
  .strip-submit {
    flex: none;
    height: 40px;
    padding: 0 18px;
    border: 2px solid transparent;
    border-radius: 12px;
    background: var(--green);
    color: #fff;
    font: 700 15px var(--font);
    cursor: pointer;
  }
  .strip-submit.resubmit {
    background: var(--accent);
  }
  /* Something still to order: yellow until it's all in (submitting asks first). */
  .strip-submit.incomplete {
    background: var(--amber);
  }
  .strip-submit.plain {
    background: var(--accent);
  }
  /* A sandbox's Resolve is always amber. */
  .strip-submit.sandbox {
    background: var(--amber);
  }
  .strip-submit:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
