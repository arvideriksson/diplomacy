<script lang="ts">
  // Pick the name other players see. On first sign-in it can't be dismissed (prefilled
  // with the Google name, so one click accepts it); from the user menu it's a rename.
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { user, metaDisplayName, setDisplayName } from '../lib/auth'
  import { fetchGames } from '../lib/game'
  import { errorMessage } from '../lib/errors'
  import Modal from './Modal.svelte'

  export let firstTime = false
  export let onClose: (() => void) | undefined = undefined

  let name = metaDisplayName(get(user)?.user_metadata) ?? ''
  let input: HTMLInputElement
  let saving = false
  let error = ''

  $: trimmed = name.trim()
  $: valid = trimmed.length >= 2 && trimmed.length <= 32

  onMount(() => input?.select())

  async function save() {
    if (!valid || saving) return
    saving = true
    error = ''
    try {
      await setDisplayName(trimmed)
      // Rosters carry the name, so refresh the list to show it.
      fetchGames().catch(() => {})
      onClose?.()
    } catch (e) {
      error = errorMessage(e)
    } finally {
      saving = false
    }
  }
</script>

<Modal title={firstTime ? 'Choose your name' : 'Change name'} top="96px" onClose={firstTime ? undefined : onClose}>
  {#if firstTime}
    <p class="hint">This is how other players will see you. You can change it later from your avatar.</p>
  {/if}
  <div class="row">
    <input
      bind:this={input}
      bind:value={name}
      class="input"
      placeholder="Your name"
      maxlength="32"
      aria-label="Display name"
      on:keydown={(e) => e.key === 'Enter' && save()}
    />
    <button class="btn btn-primary" on:click={save} disabled={!valid || saving}>
      {saving ? 'Saving…' : firstTime ? 'Continue' : 'Save'}
    </button>
  </div>
  {#if error}
    <p class="error">{error}</p>
  {/if}
</Modal>

<style>
  .hint {
    margin: 0 0 14px;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .error {
    margin: 10px 0 0;
    font-size: 13px;
    color: var(--red);
  }

  .row {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }

  .row .btn {
    flex-shrink: 0;
  }
</style>
