<script lang="ts">
  import { fade, scale } from 'svelte/transition'

  export let title: string
  export let onClose: () => void
  /** Widest the dialog grows (px). */
  export let maxWidth = 440
  /** Space above the dialog (px). */
  export let top = 48
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="overlay" style:padding-top="{top}px" transition:fade={{ duration: 150 }} on:click={onClose}>
  <div
    class="modal"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label={title}
    style:max-width="{maxWidth}px"
    transition:scale={{ duration: 150, start: 0.96 }}
    on:click|stopPropagation
  >
    <div class="modal-head">
      <h2>{title}</h2>
      <button class="close" on:click={onClose} aria-label="Close">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
    <slot />
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 48px 16px;
    overflow-y: auto;
  }

  .modal {
    width: 100%;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg, 0 20px 50px rgba(0, 0, 0, 0.3));
    padding: 22px 24px 24px;
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .modal-head h2 {
    font-size: 17px;
    font-weight: 700;
    margin: 0;
    color: var(--text);
  }

  .close {
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    padding: 4px;
    display: flex;
    border-radius: var(--radius-sm);
    transition: background 0.12s, color 0.12s;
  }

  .close:hover {
    background: var(--bg-input);
    color: var(--text);
  }
</style>
