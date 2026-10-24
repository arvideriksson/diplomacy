<script lang="ts">
  import { formatMinutes } from '../lib/time'

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

  const fmt = (min: number) => formatMinutes(min, { zeroLabel: 'Off' })

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
  .grace-opts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
  }
</style>
