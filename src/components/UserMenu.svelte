<script lang="ts">
  import { user, signOut } from '../lib/auth'
  import { fade } from 'svelte/transition'

  let showMenu = false
</script>

{#if $user}
  <div class="user-menu" transition:fade={{ duration: 200 }}>
    <button class="avatar-btn" on:click={() => (showMenu = !showMenu)}>
      {#if $user.user_metadata?.avatar_url}
        <img src={$user.user_metadata.avatar_url} alt="avatar" class="avatar" />
      {:else}
        <div class="avatar placeholder">
          {$user.email?.[0]?.toUpperCase() ?? '?'}
        </div>
      {/if}
    </button>

    {#if showMenu}
      <div class="dropdown" transition:fade={{ duration: 150 }}>
        <p class="email">{$user.email}</p>
        <button class="sign-out" on:click={signOut}>Sign out</button>
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
    border: none;
    cursor: pointer;
    padding: 0;
  }

  .avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
  }

  .placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #4a5568;
    color: white;
    font-weight: 600;
    font-size: 14px;
  }

  .dropdown {
    position: absolute;
    right: 0;
    top: 44px;
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 12px 16px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    min-width: 200px;
    z-index: 100;
  }

  .email {
    font-size: 13px;
    color: #718096;
    margin: 0 0 8px;
  }

  .sign-out {
    width: 100%;
    padding: 8px;
    background: none;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    color: #e53e3e;
    transition: background 0.15s;
  }

  .sign-out:hover {
    background: #fff5f5;
  }
</style>
