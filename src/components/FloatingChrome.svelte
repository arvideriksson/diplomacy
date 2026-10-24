<script lang="ts">
  import { useLocation } from 'svelte-routing'
  import UserMenu from './UserMenu.svelte'
  import Icon from './Icon.svelte'

  export let onBack: () => void

  const location = useLocation()
</script>

{#if $location.pathname !== '/'}
  <button class="float glass back" on:click={onBack} title="Back to games" aria-label="Back to games">
    <Icon name="back" strokeWidth={2.2} round />
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
    /* .glass, with the softer page-level shadow (it floats over the page, not the map). */
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
