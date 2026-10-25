<script lang="ts">
  // Footer of the order panel: the Submit button and its committed states.
  // Presentational — the parent owns the submit/load logic and passes its state in.

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
  /** Something is still left to order: Submit/Resubmit turn yellow (it would go in incomplete). */
  export let incomplete: boolean = false
  export let onSubmit: () => void

  // Submit-button state machine:
  //   not submitted        → green  "Submit" button
  //   submitted, no edits   → green  "✓ Submitted" status
  //   submitted, edited     → blue   "Resubmit" button
  //   resubmitted, no edits → blue   "✓ Resubmitted" status
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
    <button class="primary resolve" on:click={onSubmit}>Resolve</button>
  {:else if idle || pressed}
    <!-- Nothing to press: committed (shown at once while the save is in flight), or nothing
         to order this phase (auto-readied server-side). A calm confirmation, not a button. -->
    <div class="done-bar" class:resubmit={!idle && tone === 'resubmit'} role="status">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
      <strong>{idle ? 'Nothing to order' : label}</strong>
    </div>
  {:else}
    <!-- Submit (green, amber while units are unordered) or Resubmit (blue). -->
    <button
      class="primary"
      class:submit={tone === 'submit'}
      class:resubmit={tone === 'resubmit'}
      class:incomplete
      on:click={onSubmit}
    >
      {label}
    </button>
  {/if}
  {#if error}<span class="status error">{error}</span>{/if}
</div>

<style>
  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .actions .primary {
    min-height: 46px;
  }
  /* Full-width, prominent primary action: Submit (green) / Resubmit (blue). */
  .actions .primary {
    width: 100%;
    padding: 10px 16px;
    border: none;
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
  .actions .primary.resolve {
    background: var(--amber, #d97706);
  }
  .actions .primary.resubmit {
    background: var(--accent, #2563eb);
  }
  .actions .primary.incomplete {
    background: var(--amber, #d97706);
  }
  .actions .primary:disabled {
    opacity: 0.6;
    cursor: default;
  }
  /* A status, not a button: centred check + label, no slab. */
  .done-bar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 40px;
    color: var(--green);
  }
  .done-bar.resubmit {
    color: var(--accent);
  }
  .done-bar svg {
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .done-bar strong {
    font-size: 14px;
    color: var(--text);
  }
  .status {
    font-size: 13px;
    color: var(--text-secondary, #777);
  }
  .status.error {
    color: #dc2626;
  }
</style>
