<script lang="ts">
  import { user, signOut } from '../lib/auth'
  import { fade, fly } from 'svelte/transition'

  let showMenu = false

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
      {#if $user.user_metadata?.avatar_url}
        <img src={$user.user_metadata.avatar_url} alt="" class="avatar" />
      {:else}
        <div class="avatar placeholder">
          {$user.email?.[0]?.toUpperCase() ?? '?'}
        </div>
      {/if}
    </button>

    {#if showMenu}
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div class="dropdown" transition:fly={{ y: -8, duration: 180 }} on:click|stopPropagation>
        <div class="dropdown-header">
          {#if $user.user_metadata?.full_name}
            <p class="name">{$user.user_metadata.full_name}</p>
          {/if}
          <p class="email">{$user.email}</p>
        </div>
        <div class="dropdown-divider"></div>
        <button class="dropdown-item sign-out" on:click={signOut}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
          Sign out
        </button>
      </div>
    {/if}
  </div>
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

  .avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    display: block;
  }

  .placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent);
    color: var(--text-inverse);
    font-weight: 600;
    font-size: 13px;
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

  .name {
    margin: 0 0 2px;
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
