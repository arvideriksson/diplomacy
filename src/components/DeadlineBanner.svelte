<script lang="ts">
  // Deadline countdown under the phase banner: live "time left" plus the exact local
  // resolution time, or — once the deadline has passed — the grace period, naming who
  // the phase is waiting on. Renders nothing without a deadline.
  import { deadlineState, formatCountdown, formatDeadline, nowStore } from '../lib/time'

  /** ISO time the current phase auto-resolves. Null in lobby/history/sandbox. */
  export let deadline: string | null = null
  /** When the phase stops waiting on `awaiting` past the deadline and resolves anyway. */
  export let graceEndsAt: string | null = null
  /** Powers yet to submit this round; once the deadline passes the phase waits on them. */
  export let awaiting: string[] = []
  /** Phones: the countdown already sits in the top bar — show only when it resolves. */
  export let brief: boolean = false

  const now = nowStore(1000)
  $: dl = deadlineState(deadline, graceEndsAt, $now)
  $: deadlineAbs = formatDeadline(deadline)
</script>

{#if dl.kind === 'grace'}
  <div class="deadline grace" role="status">
    <span class="grace-label">Grace period</span>
    {#if awaiting.length}<span class="grace-detail">Waiting on {awaiting.join(', ')}</span>{/if}
    <span class="countdown">{formatCountdown(dl.msLeft ?? 0)}</span>
    <span class="deadline-abs">Resolves early once all orders are in</span>
  </div>
{:else if dl.msLeft != null && brief}
  <div class="deadline brief">
    <span class="deadline-abs">Resolves {deadlineAbs}</span>
  </div>
{:else if dl.msLeft != null}
  <div class="deadline row" class:urgent={dl.urgent}>
    <span class="countdown">{formatCountdown(dl.msLeft)}</span>
    <span class="deadline-abs">· {deadlineAbs}</span>
  </div>
{/if}

<style>
  .deadline {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
  }
  .deadline.row {
    flex-direction: row;
    justify-content: center;
    align-items: baseline;
    gap: 6px;
  }
  .deadline.row .deadline-abs {
    font-size: 12px;
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
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .deadline .deadline-abs {
    font-size: 11px;
    color: var(--text-secondary);
  }
  .deadline.urgent .countdown {
    color: var(--red);
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
    color: var(--text);
  }
</style>
