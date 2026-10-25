<script lang="ts">
  import { user, displayName, signOut } from '../lib/auth'
  import { fade, fly } from 'svelte/transition'
  import Avatar from './Avatar.svelte'
  import Icon from './Icon.svelte'
  import NameDialog from './NameDialog.svelte'

  let showMenu = false
  let renaming = false

  function rename() {
    showMenu = false
    renaming = true
  }

  function handleClickOutside(e: MouseEvent) {
    if (showMenu) showMenu = false
  }
</script>

<svelte:window on:click={handleClickOutside} />

{#if $user}
  <div class="user-menu" transition:fade={{ duration: 150 }}>
    <button
      class="avatar-btn"
      on:click|stopPropagation={() => (showMenu = !showMenu)}
      aria-expanded={showMenu}
    >
      <Avatar name={$displayName} />
    </button>

    {#if showMenu}
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div class="dropdown" transition:fly={{ y: -8, duration: 180 }} on:click|stopPropagation>
        <div class="dropdown-header">
          <div class="name-row">
            <p class="name">{$displayName && $displayName !== $user.email ? $displayName : 'No name'}</p>
            <button class="edit-name" on:click={rename} title="Change name" aria-label="Change name">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
              </svg>
            </button>
          </div>
          <p class="email">{$user.email}</p>
        </div>
        <div class="dropdown-divider"></div>
        <button class="dropdown-item sign-out" on:click={signOut}>
          <Icon name="logout" size={16} />
          Sign out
        </button>
      </div>
    {/if}
  </div>

  {#if renaming}
    <NameDialog onClose={() => (renaming = false)} />
  {/if}
{/if}

<style>
  .user-menu {
    position: relative;
  }

  .avatar-btn {
    background: none;
    border: 2px solid transparent;
    border-radius: 50%;
    cursor: pointer;
    padding: 2px;
    transition: border-color 0.15s;
  }

  .avatar-btn:hover, .avatar-btn[aria-expanded="true"] {
    border-color: var(--border-strong);
  }

  .dropdown {
    position: absolute;
    right: 0;
    top: calc(100% + 8px);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    min-width: 220px;
    z-index: 100;
    overflow: hidden;
  }

  .dropdown-header {
    padding: 14px 16px;
  }

  .name-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 2px;
  }

  .edit-name {
    display: flex;
    padding: 4px;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-tertiary);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }

  .edit-name:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .name {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
  }

  .email {
    font-size: 13px;
    color: var(--text-tertiary);
    margin: 0;
  }

  .dropdown-divider {
    height: 1px;
    background: var(--border);
  }

  .dropdown-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 16px;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 14px;
    font-family: var(--font);
    transition: background 0.12s;
    text-align: left;
  }

  .dropdown-item:hover {
    background: var(--bg-hover);
  }

  .sign-out {
    color: var(--red);
  }
</style>
