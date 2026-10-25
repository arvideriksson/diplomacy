<script lang="ts">
  // A live "23h 42m" to a deadline (the grace period's end once it has passed),
  // ticking every second. Renders nothing without a deadline.
  import { onDestroy } from 'svelte'
  import { formatCountdown } from '../lib/time'

  export let deadline: string | null = null
  export let graceEndsAt: string | null = null

  let now = Date.now()
  const clock = setInterval(() => (now = Date.now()), 1000)
  onDestroy(() => clearInterval(clock))

  $: msLeft = deadline ? new Date(deadline).getTime() - now : null
  $: graceLeft = graceEndsAt ? new Date(graceEndsAt).getTime() - now : null
  $: inGrace = msLeft != null && msLeft <= 0 && graceLeft != null && graceLeft > 0
  $: urgent = msLeft != null && (inGrace || msLeft <= 60 * 60 * 1000)
</script>

{#if msLeft != null}
  <span class="countdown" class:urgent title={inGrace ? 'Grace period' : 'Time left'}>
    {formatCountdown(inGrace ? graceLeft! : msLeft).replace(/ left$/, '')}
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
</style>
