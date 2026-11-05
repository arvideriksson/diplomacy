<script lang="ts" generics="T">
  // A row of square segments, one selected. Used for the lobby's settings.
  export let options: { value: T; label: string }[]
  export let value: T
  export let disabled = false
  /** Accessible name for the group. */
  export let label: string
  export let onChange: (value: T) => void
</script>

<div class="segmented" role="radiogroup" aria-label={label}>
  {#each options as o (o.label)}
    <button
      type="button"
      role="radio"
      aria-checked={o.value === value}
      class:on={o.value === value}
      {disabled}
      on:click={() => o.value !== value && onChange(o.value)}
    >{o.label}</button>
  {/each}
</div>

<style>
  .segmented {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--bg-card);
  }
  button {
    min-width: 0;
    height: 34px;
    padding: 0 6px;
    border: none;
    border-left: 1px solid var(--border-strong);
    background: none;
    color: var(--text-secondary);
    font: 600 13px var(--font);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  button:first-child {
    border-left: none;
  }
  @media (hover: hover) {
    button:hover:not(.on):not(:disabled) {
      background: var(--bg-hover);
      color: var(--text);
    }
  }
  button.on {
    background: var(--text);
    color: var(--bg-card);
  }
  button:disabled {
    cursor: default;
  }
  button:disabled:not(.on) {
    opacity: 0.6;
  }
  /* Phones: six segments have to fit in ~350px. */
  @media (max-width: 600px) {
    button {
      padding: 0 2px;
      font-size: 12.5px;
    }
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
</style>
