<script lang="ts">
  // Shown when a guest tries something that needs an account (joining or creating a
  // game). Google sign-in comes back to the same page (signInWithGoogle keeps the path),
  // so they can carry on where they were.
  import { signInPrompt } from '../lib/auth'
  import Modal from './Modal.svelte'
  import LoginButton from './LoginButton.svelte'

  const close = () => signInPrompt.set(null)
</script>

{#if $signInPrompt}
  <Modal title="Sign in to play" top="max(48px, 18vh)" maxWidth="380px" onClose={close}>
    <p class="why">You're browsing as a guest. Sign in {$signInPrompt}.</p>
    <div class="actions">
      <LoginButton />
      <button class="btn btn-ghost" type="button" on:click={close}>Keep browsing</button>
    </div>
  </Modal>
{/if}

<style>
  .why {
    margin: 0 0 20px;
    color: var(--text-secondary);
    font-size: 14px;
    line-height: 1.5;
  }
  .actions {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .actions :global(.login-btn) {
    justify-content: center;
  }
</style>
