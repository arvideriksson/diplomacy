<script lang="ts">
  // A live "23h 42m" to a deadline (the grace period's end once it has passed),
  // ticking every second. Renders nothing without a deadline. `pill`: the phone top
  // bar's boxed clock, amber during a grace period.
  import { deadlineState, formatCountdown, nowStore } from '../lib/time'

  export let deadline: string | null = null
  export let graceEndsAt: string | null = null
  export let pill: boolean = false

  const now = nowStore(1000)
  $: dl = deadlineState(deadline, graceEndsAt, $now)
  $: inGrace = dl.kind === 'grace'
</script>

{#if dl.msLeft != null}
  <span class="countdown" class:pill class:urgent={dl.urgent} class:grace={pill && inGrace} title={inGrace ? 'Grace period' : 'Time left'}>
    {formatCountdown(dl.msLeft, { suffix: false })}
  </span>
{/if}

<style>
  .countdown {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    color: var(--text-secondary);
  }
  .urgent {
    color: var(--red);
  }
  .pill {
    font-weight: 700;
    color: inherit;
    padding: 4px 6px;
    font-size: 11.5px;
    border-radius: 999px;
    background: var(--bg-hover);
    border: 1px solid var(--border);
    white-space: nowrap;
  }
  .pill.urgent {
    color: var(--red);
  }
  .pill.grace {
    color: var(--amber);
    border-color: var(--amber);
  }
</style>
