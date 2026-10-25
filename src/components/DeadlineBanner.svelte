<script lang="ts">
  // Deadline countdown under the phase banner: live "time left" plus the exact local
  // resolution time, or — once the deadline has passed with powers unready — the grace
  // period, naming who the phase is waiting on. Renders nothing without a deadline.
  import { onDestroy } from 'svelte'
  import { formatCountdown, formatDeadline } from '../lib/time'

  /** ISO time the current phase auto-resolves. Null in lobby/history/sandbox. */
  export let deadline: string | null = null
  /** When the phase stops waiting on `awaiting` past the deadline and resolves anyway. */
  export let graceEndsAt: string | null = null
  /** Powers yet to submit this round; once the deadline passes the phase waits on them. */
  export let awaiting: string[] = []
  /** Phones: the countdown already sits in the top bar — show only when it resolves. */
  export let brief: boolean = false

  // Ticks every second so the countdown stays honest; cleared on destroy.
  let now = Date.now()
  const clock = setInterval(() => (now = Date.now()), 1000)
  onDestroy(() => clearInterval(clock))

  $: deadlineMs = deadline ? new Date(deadline).getTime() : null
  $: msLeft = deadlineMs == null ? null : deadlineMs - now
  $: deadlineUrgent = msLeft != null && msLeft <= 60 * 60 * 1000 // ≤ 1h
  // Grace period: the deadline passed with powers unready, so the phase waits until the
  // last of them submits or the grace runs out (games.grace_ends_at).
  $: graceMsLeft = graceEndsAt ? new Date(graceEndsAt).getTime() - now : null
  $: inGrace = msLeft != null && msLeft <= 0 && graceMsLeft! > 0 && awaiting.length > 0
  $: deadlineAbs = formatDeadline(deadlineMs)
</script>

{#if inGrace && msLeft != null}
  <div class="deadline grace" role="status">
    <span class="grace-label">Grace period</span>
    <span class="grace-detail">Waiting on {awaiting.join(', ')}</span>
    <span class="countdown">{formatCountdown(graceMsLeft ?? 0)}</span>
    <span class="deadline-abs">Resolves early once all orders are in</span>
  </div>
{:else if msLeft != null && brief}
  <div class="deadline brief">
    <span class="deadline-abs">Resolves {deadlineAbs}</span>
  </div>
{:else if msLeft != null}
  <div class="deadline" class:urgent={deadlineUrgent}>
    <span class="countdown">{formatCountdown(msLeft)}</span>
    <span class="deadline-abs">{deadlineAbs}</span>
  </div>
{/if}

<style>
  .deadline {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--border, #eee);
  }
  .deadline.brief {
    padding: 10px 16px;
  }
  .deadline.brief .deadline-abs {
    font-size: 12.5px;
  }
  .deadline .countdown {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: -0.1px;
    color: var(--text, #1a1a1a);
    font-variant-numeric: tabular-nums;
  }
  .deadline .deadline-abs {
    font-size: 11px;
    color: var(--text-secondary);
  }
  .deadline.urgent .countdown {
    color: var(--red, #dc2626);
  }
  .deadline.grace {
    background: var(--amber-subtle);
    box-shadow: inset 3px 0 0 var(--amber);
    text-align: center;
  }
  .deadline.grace .grace-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--amber);
  }
  .deadline.grace .grace-detail {
    font-size: 14px;
    font-weight: 700;
    color: var(--text, #1a1a1a);
  }
</style>
