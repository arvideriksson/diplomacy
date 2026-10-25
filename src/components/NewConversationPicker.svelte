<script lang="ts">
  // New-conversation screen, like a messenger's "New message": tick one or more players
  // (flag, username, nation), optionally name the group, then start. An unnamed set that
  // already has a thread just reopens it, so the button says so.
  import { NAME_MAX, type ChatStore, type chatLabels } from '../lib/chatStore'
  import ChatAvatar from './ChatAvatar.svelte'
  import Icon from './Icon.svelte'

  export let chat: ChatStore
  export let labels: ReturnType<typeof chatLabels>
  /** The viewer's nation. */
  export let nation: string
  /** Nations that can be messaged (everyone in the game but the viewer). */
  export let otherNations: string[]
  /** Single-pane layout: show a back arrow to the list. */
  export let onBack: (() => void) | null = null

  const { pickerSel, pickerName, error, channels } = chat
  $: ({ display, userOf } = labels)
  $: group = $pickerSel.length > 1
  // Only groups get a name; dropping back to one recipient drops it too.
  $: if (!group && $pickerName) pickerName.set('')
  $: existing = !$pickerName.trim() && $pickerSel.length > 0
    ? $channels.find((c) => !c.name && !c.is_public &&
        c.members.length === $pickerSel.length + 1 &&
        [nation, ...$pickerSel].every((n) => c.members.includes(n)))
    : undefined
</script>

<div class="picker">
  <header class="head">
    {#if onBack}
      <button class="icon-btn back" on:click={onBack} aria-label="Back to conversations" title="Back">
        <Icon name="back" size={22} strokeWidth={2.4} round />
      </button>
    {/if}
    <h2>New conversation</h2>
    {#if !onBack}
      <button class="icon-btn" on:click={chat.cancelPicking} aria-label="Cancel" title="Cancel">
        <Icon name="close" size={20} />
      </button>
    {/if}
  </header>

  <div class="to">
    <span class="to-label">To:</span>
    {#each $pickerSel as n (n)}
      <button class="chip" on:click={() => chat.togglePick(n)} aria-label="Remove {userOf(n) ?? display(n)}">
        <ChatAvatar {labels} nations={[n]} size={20} />
        {userOf(n) ?? display(n)}
        <Icon name="close" size={14} />
      </button>
    {:else}
      <span class="to-hint">Pick one player, or several for a group</span>
    {/each}
  </div>

  <ul class="people" aria-label="Players">
    {#each otherNations as n (n)}
      {@const on = $pickerSel.includes(n)}
      <li>
        <button class="person" class:on role="checkbox" aria-checked={on} on:click={() => chat.togglePick(n)}>
          <ChatAvatar {labels} nations={[n]} size={40} />
          <span class="who">
            <span class="name">{userOf(n) ?? display(n)}</span>
            {#if userOf(n)}<span class="nation">{display(n)}</span>{/if}
          </span>
          <span class="tick" aria-hidden="true">{#if on}<Icon name="check" size={14} strokeWidth={3} />{/if}</span>
        </button>
      </li>
    {/each}
  </ul>

  <footer class="foot">
    {#if group}
      <div class="name-field">
        <input
          class="name-input"
          maxlength={NAME_MAX}
          placeholder="Group name (optional)"
          aria-label="Group name"
          bind:value={$pickerName}
        />
        {#if $pickerName.length >= NAME_MAX - 10}
          <span class="counter" class:full={$pickerName.length >= NAME_MAX}>{$pickerName.length}/{NAME_MAX}</span>
        {/if}
      </div>
    {/if}
    {#if $error}<p class="err">{$error}</p>{/if}
    <button class="btn btn-primary start" disabled={$pickerSel.length === 0} on:click={chat.startConversation}>
      {existing ? 'Open conversation' : group && $pickerName.trim() ? `Create “${$pickerName.trim()}”` : 'Start conversation'}
    </button>
  </footer>
</div>

<style>
  .picker {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 60px;
    padding: 8px 10px 8px 16px;
    border-bottom: 1px solid var(--border);
  }
  .head:has(.back) {
    padding-left: 4px;
  }
  .head h2 {
    flex: 1;
    margin: 0;
    font-size: 16px;
    font-weight: 650;
  }
  .icon-btn {
    flex: none;
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 50%;
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .icon-btn:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .icon-btn.back {
    color: var(--accent);
  }
  .to {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-height: 52px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
  }
  .to-label {
    color: var(--text-secondary);
    font-weight: 600;
    margin-right: 2px;
  }
  .to-hint {
    color: var(--text-tertiary);
    font-size: 14px;
  }
  .chip {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    padding: 0 10px 0 6px;
    border: none;
    border-radius: var(--radius-full);
    background: var(--accent-muted);
    color: var(--text);
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
  }
  .chip::after {
    content: '';
    position: absolute;
    inset: -4px 0;
  }
  .chip :global(svg) {
    color: var(--text-secondary);
  }
  .people {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    list-style: none;
    margin: 0;
    padding: 6px;
  }
  .person {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 56px;
    padding: 8px 10px;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .person:hover {
    background: var(--bg-hover);
  }
  .who {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .name {
    font-size: 15px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .nation {
    font-size: 13px;
    color: var(--text-secondary);
  }
  .tick {
    flex: none;
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: 2px solid var(--border-strong);
    color: #fff;
  }
  .person.on .tick {
    background: var(--accent);
    border-color: var(--accent);
  }
  .foot {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px));
    border-top: 1px solid var(--border);
  }
  .name-field {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .name-input {
    height: 42px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    padding: 0 12px;
    font: inherit;
    font-size: 15px;
    background: var(--bg-input);
    color: var(--text);
    outline: none;
  }
  .name-input:focus {
    border-color: var(--accent);
  }
  @media (pointer: coarse) {
    .name-input {
      font-size: 16px;
    }
  }
  .counter {
    align-self: flex-end;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--amber);
  }
  .counter.full {
    color: var(--red);
    font-weight: 600;
  }
  .start {
    height: 44px;
    width: 100%;
    font-size: 15px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .start:disabled {
    opacity: 0.45;
  }
  .err {
    color: var(--red);
    margin: 0;
    font-size: 13px;
  }
</style>
