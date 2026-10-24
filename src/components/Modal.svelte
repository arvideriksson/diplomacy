<script lang="ts">
  // Centered dialog over a dimmed backdrop, with a title and a close ✕. Clicking the
  // backdrop or pressing Escape closes it. The body goes in the default slot.
  import { fade, scale } from 'svelte/transition'
  import Icon from './Icon.svelte'

  export let title: string
  export let maxWidth = '420px'
  /** Distance from the top of the viewport to the dialog. */
  export let top = '48px'
  export let onClose: () => void

  const onKeydown = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
</script>

<svelte:window on:keydown={onKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="overlay" style:padding-top={top} transition:fade={{ duration: 150 }} on:click={onClose}>
  <div
    class="modal"
    style:max-width={maxWidth}
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label={title}
    transition:scale={{ duration: 150, start: 0.96 }}
    on:click|stopPropagation
  >
    <div class="modal-head">
      <h2>{title}</h2>
      <button class="close" on:click={onClose} aria-label="Close">
        <Icon name="close" />
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
    box-shadow: var(--shadow-lg);
    padding: 22px 24px 24px;
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
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
    background: var(--bg-hover);
    color: var(--text);
  }
</style>
