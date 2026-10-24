<script lang="ts">
  /**
   * Grace period length (minutes) a phase waits past its deadline for unsubmitted
   * powers. null = one movement timer (the default, follows the movement setting).
   */
  export let value: number | null = null
  /** Current movement timer, shown on the default option. */
  export let movement: number
  export let disabled = false
  export let onChange: (value: number | null) => void = () => {}

  const PRESETS = [0, 720, 1440, 2880, 10080]

  function fmt(min: number): string {
    if (min === 0) return 'Off'
    if (min % 10080 === 0) return `${min / 10080}w`
    if (min % 1440 === 0) return `${min / 1440}d`
    if (min % 60 === 0) return `${min / 60}h`
    return `${min}m`
  }

  function pick(v: number | null) {
    if (disabled || v === value) return
    value = v
    onChange(v)
  }
</script>

<div class="grace-opts">
  <button type="button" class="pill" class:active={value == null} {disabled} on:click={() => pick(null)}>
    Movement ({fmt(movement)})
  </button>
  {#each PRESETS as preset (preset)}
    <button type="button" class="pill" class:active={value === preset} {disabled} on:click={() => pick(preset)}>
      {fmt(preset)}
    </button>
  {/each}
</div>

<style>
  /* Pill styling matches PhaseTimerSettings. */
  .grace-opts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
  }
  .pill {
    padding: 6px 13px;
    font-size: 13px;
    font-weight: 500;
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.12s;
    font-family: var(--font);
  }
  .pill:hover:not(:disabled) {
    border-color: var(--border-strong);
  }
  .pill.active {
    background: var(--accent-subtle);
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }
  .pill:disabled {
    cursor: default;
    opacity: 0.65;
  }
  .pill.active:disabled {
    opacity: 1;
  }
</style>
