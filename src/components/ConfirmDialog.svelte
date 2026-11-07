<script lang="ts">
  // "Are you sure?" over a Modal: the question as its title, an optional message (or the
  // default slot), then the action and Cancel. Escape, the backdrop and ✕ cancel.
  import Modal from './Modal.svelte'

  export let title: string
  export let message = ''
  export let confirmLabel: string
  export let cancelLabel = 'Cancel'
  /** The action's colour: red for destructive, amber like an incomplete Submit. */
  export let tone: 'primary' | 'danger' | 'amber' = 'primary'
  /** The action is in flight: both buttons lock. */
  export let busy = false
  export let onConfirm: () => void
  export let onCancel: () => void
</script>

<Modal {title} onClose={busy ? undefined : onCancel} top="max(48px, 18vh)">
  {#if message}<p class="message">{message}</p>{/if}
  <slot />
  <div class="actions">
    <button class="btn {tone === 'danger' ? 'btn-danger' : 'btn-primary'}" class:amber={tone === 'amber'} disabled={busy} on:click={onConfirm}>
      {confirmLabel}
    </button>
    <button class="btn btn-ghost" disabled={busy} on:click={onCancel}>{cancelLabel}</button>
  </div>
</Modal>

<style>
  .message {
    margin: 0 0 16px;
    color: var(--text-secondary);
    line-height: 1.5;
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .btn {
    min-height: 46px;
    font-size: 15px;
  }
  .amber,
  .amber:hover:not(:disabled) {
    background: var(--amber);
    border-color: var(--amber);
    color: #fff;
  }
</style>
