<script lang="ts">
  import { useLocation } from 'svelte-routing'
  import UserMenu from './UserMenu.svelte'

  export let onBack: () => void

  const location = useLocation()
</script>

{#if $location.pathname !== '/'}
  <button class="float back" on:click={onBack} title="Back to games" aria-label="Back to games">
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
  </button>
{/if}
<div class="float user"><UserMenu /></div>

<style>
  .float {
    position: fixed;
    top: 16px;
    z-index: 50;
  }

  .back {
    left: 16px;
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: var(--text);
    background: color-mix(in srgb, var(--bg-elevated) 85%, transparent);
    backdrop-filter: blur(16px) saturate(1.5);
    -webkit-backdrop-filter: blur(16px) saturate(1.5);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-lg);
    cursor: pointer;
  }

  .back:hover {
    border-color: var(--border-strong);
  }

  .user {
    right: 16px;
  }
</style>
