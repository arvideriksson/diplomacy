<script lang="ts">
  import { user, displayName, signOut } from '../lib/auth'
  import { fade, fly } from 'svelte/transition'
  import Avatar from './Avatar.svelte'
  import Icon from './Icon.svelte'
  import NameDialog from './NameDialog.svelte'
  import Toggle from './Toggle.svelte'
  import { pushSupported, pushEnabled, enablePush, disablePush } from '../lib/push'
  import { influencePaint } from '../lib/mapPrefs'
  import { errorMessage } from '../lib/errors'
  import { dismissable } from '../lib/actions/dismissable'

  let showMenu = false
  let renaming = false

  function rename() {
    showMenu = false
    renaming = true
  }

  let pushBusy = false
  let pushBlocked = false
  let pushError = ''

  async function setPush(on: boolean) {
    pushBusy = true
    pushError = ''
    try {
      if (on) pushBlocked = !(await enablePush())
      else await disablePush(true)
    } catch (e) {
      pushError = errorMessage(e)
    } finally {
      pushBusy = false
    }
  }
</script>

{#if $user}
  <div class="user-menu" transition:fade={{ duration: 150 }} use:dismissable={{ onDismiss: () => (showMenu = false), enabled: showMenu }}>
    <button
      class="avatar-btn"
      on:click={() => (showMenu = !showMenu)}
      aria-expanded={showMenu}
    >
      <Avatar name={$displayName} />
    </button>

    {#if showMenu}
      <div class="dropdown" transition:fly={{ y: -8, duration: 180 }}>
        <div class="dropdown-header">
          <div class="name-row">
            <p class="name">{$displayName && $displayName !== $user.email ? $displayName : 'No name'}</p>
            <button class="edit-name" on:click={rename} title="Change name" aria-label="Change name">
              <Icon name="pencil" size={14} round />
            </button>
          </div>
          <p class="email">{$user.email}</p>
        </div>
        <div class="dropdown-divider"></div>
        {#if $pushSupported}
          <div class="dropdown-item push-row">
            <Icon name="bell" size={16} />
            <span class="push-label">{pushBlocked ? 'Notifications blocked' : 'Notifications'}</span>
            <Toggle
              checked={$pushEnabled}
              disabled={pushBusy}
              label="Notifications"
              onChange={setPush}
            />
          </div>
          {#if pushError}<p class="form-error push-error">{pushError}</p>{/if}
          <div class="dropdown-divider"></div>
        {/if}
        <div class="dropdown-item push-row">
          <Icon name="map" size={16} />
          <span class="push-label">Influence on map</span>
          <Toggle
            checked={$influencePaint}
            label="Influence on map"
            onChange={(on) => influencePaint.set(on)}
          />
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

  .push-row {
    cursor: default;
    color: var(--text);
  }

  .push-row:hover {
    background: none;
  }

  .push-label {
    flex: 1;
  }

  .push-error {
    margin: 0 16px 10px;
  }

  .sign-out {
    color: var(--red);
  }
</style>
