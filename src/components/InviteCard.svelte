<script lang="ts">
  // Lobby "Invite Players" card: the join link, copied to the clipboard on click.
  import { fade } from 'svelte/transition'

  /** The game's UUID is the invite token — anyone with the link can join the lobby. */
  export let gameId: string

  let copied = false

  $: inviteLink = `${window.location.origin}/join/${gameId}`

  function copyInviteLink() {
    navigator.clipboard.writeText(inviteLink)
    copied = true
    setTimeout(() => (copied = false), 2000)
  }
</script>

<section class="card invite-card">
  <div class="card-head">
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
    <h2>Invite Players</h2>
  </div>
  <button class="invite-link-display" on:click={copyInviteLink} class:copied>
    <span class="link-text">{inviteLink}</span>
    {#if copied}
      <span class="copy-label" transition:fade={{ duration: 120 }}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        Copied
      </span>
    {:else}
      <span class="copy-label">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
        Copy
      </span>
    {/if}
  </button>
</section>

<style>
  .invite-card {
    background: var(--accent-subtle);
    border-color: var(--accent-muted);
  }

  .invite-link-display {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 12px 16px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-family: var(--font);
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .invite-link-display:hover {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-subtle);
  }

  .invite-link-display.copied {
    border-color: var(--green);
    box-shadow: 0 0 0 3px var(--green-subtle);
  }

  .link-text {
    flex: 1;
    min-width: 0;
    font-family: var(--mono);
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .copy-label {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-tertiary);
  }

  .copied .copy-label {
    color: var(--green);
  }
</style>
