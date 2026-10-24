<script lang="ts">
  // New-conversation picker: choose recipients, optionally name the group, start.
  import { NAME_MAX, type ChatStore, type chatLabels } from '../lib/chatStore'

  export let chat: ChatStore
  export let labels: ReturnType<typeof chatLabels>
  /** Nations that can be messaged (everyone in the game but the viewer). */
  export let otherNations: string[]

  const { pickerSel, pickerName, error } = chat
  $: ({ display, colorOf } = labels)
</script>

<div class="picker">
  <p class="hint">Message whom?</p>
  <div class="chips">
    {#each otherNations as n}
      <button
        class="chip"
        class:on={$pickerSel.includes(n)}
        style="--c: {colorOf(n)}"
        on:click={() => chat.togglePick(n)}
      >{display(n)}</button>
    {/each}
  </div>
  <div class="name-field">
    <input class="name-input" maxlength={NAME_MAX} placeholder="Optional name (e.g. Western Triple)" bind:value={$pickerName} />
    {#if $pickerName.length >= NAME_MAX - 10}
      <span class="counter" class:full={$pickerName.length >= NAME_MAX}>{$pickerName.length}/{NAME_MAX}</span>
    {/if}
  </div>
  <p class="hint sub">
    {$pickerName.trim()
      ? 'Creates a distinct named group.'
      : 'No name — reopens the existing thread for this exact set.'}
  </p>
  <div class="picker-actions">
    <button class="btn btn-primary btn-sm" disabled={$pickerSel.length === 0} on:click={chat.startConversation}>Start</button>
    <button class="link" on:click={chat.cancelPicking}>Cancel</button>
  </div>
  {#if $error}<p class="err">{$error}</p>{/if}
</div>

<style>
  .picker {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .hint {
    margin: 0;
    color: var(--text-secondary, #666);
    font-size: 13px;
  }
  .hint.sub {
    font-size: 12px;
    margin-top: -4px;
  }
  .name-field {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .name-input {
    border: 1px solid var(--border-strong, #cbd5e1);
    border-radius: 8px;
    padding: 7px 9px;
    font: inherit;
    background: var(--bg-input, #fff);
    color: var(--text, #1a1a1a);
  }
  /* Quiet near-limit hint: appears only in the last 10 chars, reddens at the cap. */
  .counter {
    align-self: flex-end;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--amber, #b45309);
  }
  .counter.full {
    color: #dc2626;
    font-weight: 600;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    padding: 5px 10px;
    border: 1px solid var(--border-strong, #cbd5e1);
    border-radius: 999px;
    background: var(--bg-input, #fff);
    color: var(--text, #1a1a1a);
    cursor: pointer;
  }
  .chip.on {
    background: color-mix(in srgb, var(--c) 16%, transparent);
    color: var(--c);
    border-color: var(--c);
    font-weight: 600;
  }
  .picker-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .err {
    color: #dc2626;
    margin: 0;
    padding: 6px 12px;
  }
</style>
