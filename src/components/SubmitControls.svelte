<script lang="ts">
  // Footer of the order panel: the Submit button and its committed states, the
  // discard-edits link, and the read-only "Locked in" mirror of the submitted set.
  // Presentational — the parent owns the submit/load logic and passes its state in.
  import type { AnyOrder } from '../lib/orders/types'
  import { orderSource } from '../lib/orders/board'

  /** Sandbox: a plain Submit that resolves locally; none of the live states apply. */
  export let sandbox: boolean = false
  /** Nothing to do this phase (auto-readied server-side): show an inert "Waiting…". */
  export let idle: boolean = false
  /** A submit is in flight. */
  export let saving: boolean = false
  /** This nation is ready (optimistically, while a submit is in flight). */
  export let ready: boolean = false
  /** Edits made since submitting, not yet resubmitted. */
  export let dirty: boolean = false
  /** The user resubmitted in this view (Resubmitted rather than Submitted). */
  export let resubmitted: boolean = false
  export let error: string = ''
  /** The set locked in on the server, shown read-only once ready. */
  export let locked: AnyOrder[] = []
  export let format: (o: AnyOrder) => string
  export let onSubmit: () => void
  export let onDiscard: () => void = () => {}

  // Submit-button state machine:
  //   not submitted        → green  "Submit"
  //   submitted, no edits   → green  "Submitted"   (pressed, inert)
  //   submitted, edited     → blue   "Resubmit"
  //   resubmitted, no edits → blue   "Resubmitted" (pressed, inert)
  $: pressed = saving || (ready && !dirty)
  $: tone = !ready || (!dirty && !resubmitted) ? 'submit' : 'resubmit'
  // No transient "Submitting…": clicking jumps straight to the committed label.
  // While the save is in flight, optimistically show the target committed state.
  $: label = saving
    ? ready
      ? 'Resubmitted'
      : 'Submitted'
    : !ready
      ? 'Submit'
      : dirty
        ? 'Resubmit'
        : resubmitted
          ? 'Resubmitted'
          : 'Submitted'
</script>

<div class="actions">
  {#if sandbox}
    <button class="primary submit" on:click={onSubmit}>Submit</button>
  {:else if idle}
    <!-- Nothing to do this phase: auto-readied server-side, just waiting on others. -->
    <button class="primary waiting pressed" disabled>Waiting…</button>
  {:else}
    <!-- Submit→Submitted (green) then Resubmit→Resubmitted (blue); pressed = committed, inert. -->
    <button
      class="primary"
      class:submit={tone === 'submit'}
      class:resubmit={tone === 'resubmit'}
      class:pressed
      on:click={onSubmit}
      disabled={saving || pressed}
    >
      {label}
    </button>
    {#if ready && dirty}
      <div class="actions-secondary">
        <button class="link" on:click={onDiscard} disabled={saving}>Discard changes</button>
      </div>
    {/if}
  {/if}
  {#if error}<span class="status error">{error}</span>{/if}
</div>

{#if !sandbox && ready && locked.length}
  <!-- Read-only mirror of the set actually locked in on the server. Survives
       Phase 2 edits so it stays the committed truth, not the live draft. -->
  <div class="locked-box">
    <div class="locked-head">
      <span class="locked-dot"></span>
      Locked in
    </div>
    <ul class="locked-list">
      {#each locked as o (orderSource(o))}
        <li>{format(o)}</li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--border, #eee);
  }
  /* Full-width, prominent primary action: Submit (green) / Resubmit (blue). */
  .actions .primary {
    width: 100%;
    padding: 12px 16px;
    /* Transparent 2px border so the committed "pressed" state (which adds a 2px
       outline) has identical dimensions — Submitted == Submit, Resubmitted == Resubmit. */
    border: 2px solid transparent;
    box-sizing: border-box;
    border-radius: 8px;
    color: #fff;
    cursor: pointer;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.2px;
  }
  .actions .primary.submit {
    background: var(--green, #059669);
  }
  .actions .primary.resubmit {
    background: var(--accent, #2563eb);
  }
  .actions .primary:disabled {
    opacity: 0.6;
    cursor: default;
  }
  /* Committed state (Submitted / Resubmitted): inverted — colored outline + text on
     the dark panel fill, rather than the solid color. Reads as "done", inert. */
  .actions .primary.pressed,
  .actions .primary.pressed:disabled {
    opacity: 1;
    cursor: default;
    box-sizing: border-box;
    background: transparent;
    border: 2px solid currentColor;
    box-shadow: none;
    filter: none;
  }
  .actions .primary.submit.pressed {
    color: var(--green, #059669);
  }
  .actions .primary.resubmit.pressed {
    color: var(--accent, #2563eb);
  }
  /* Nothing to do this phase: amber, inverted, inert — waiting on the other powers. */
  .actions .primary.waiting.pressed {
    color: var(--amber, #d97706);
  }
  .actions-secondary {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
  }
  .actions-secondary .link {
    background: none;
    border: none;
    padding: 0;
    font-size: 12px;
    color: var(--text-secondary, #777);
    cursor: pointer;
  }
  .actions-secondary .link:hover {
    color: var(--text, #1a1a1a);
  }
  .actions-secondary .link:disabled {
    opacity: 0.6;
    cursor: default;
  }
  /* Locked-in orders: a calm, slightly recessed card under Submit confirming what's
     committed on the server. Green accent ties it to the "Submitted" state. */
  .locked-box {
    margin-top: 12px;
    border: 1px solid var(--green, #059669);
    border-radius: 8px;
    background: var(--green-subtle, rgba(5, 150, 105, 0.08));
    padding: 10px 12px;
  }
  .locked-head {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--green, #059669);
    margin-bottom: 8px;
  }
  .locked-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--green, #059669);
  }
  .locked-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    color: var(--text, #1a1a1a);
  }
  .status {
    font-size: 12px;
    color: var(--text-secondary, #777);
  }
  .status.error {
    color: #dc2626;
  }
</style>
