<script lang="ts">
  // A conversation's (or a sender's) picture, built from nation flags: one roundel for a
  // single nation, two overlapping for a pair, a 2×2 cluster for larger groups, and a
  // megaphone for public press.
  import type { chatLabels } from '../lib/chatStore'

  export let labels: ReturnType<typeof chatLabels>
  /** The nations to picture (the viewer is already left out). */
  export let nations: string[]
  export let isPublic = false
  export let size = 44

  $: ({ display, colorOf, flagOf } = labels)
  // A 2×2 cluster shows three flags and a "+n" once there are more than four.
  $: shown = nations.length > 4 ? nations.slice(0, 3) : nations.slice(0, 4)
  $: extra = nations.length - shown.length
  $: layout = isPublic ? 'public' : nations.length <= 1 ? 'one' : nations.length === 2 ? 'pair' : 'grid'
</script>

{#snippet flag(n: string)}
  {#if flagOf(n)}
    <img class="flag" src={flagOf(n)} alt={display(n)} title={display(n)} />
  {:else}
    <span class="flag dot" style="background: {colorOf(n)}" title={display(n)}>{display(n)[0]}</span>
  {/if}
{/snippet}

<span class="avatar {layout}" style:--size="{size}px" aria-hidden={layout === 'public' ? 'true' : undefined}>
  {#if layout === 'public'}
    <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  {:else}
    {#each shown as n (n)}{@render flag(n)}{/each}
    {#if extra > 0}<span class="flag more">+{extra}</span>{/if}
  {/if}
</span>

<style>
  .avatar {
    flex: none;
    position: relative;
    width: var(--size);
    height: var(--size);
    display: inline-block;
  }
  /* A hairline ring keeps white flag fields (France, Russia…) from melting into a
     light background. */
  .flag {
    display: block;
    border-radius: 50%;
    object-fit: cover;
    box-shadow: 0 0 0 1px var(--border-strong);
  }
  .dot,
  .more {
    display: grid;
    place-items: center;
    color: #fff;
    font-weight: 700;
    font-size: calc(var(--size) * 0.3);
  }
  .more {
    background: var(--bg-elevated);
    color: var(--text-secondary);
    box-shadow: inset 0 0 0 1px var(--border-strong);
  }
  .one .flag {
    width: 100%;
    height: 100%;
  }
  /* Pair: back flag top-left, front flag bottom-right, ringed in the panel colour. */
  .pair .flag {
    position: absolute;
    width: 70%;
    height: 70%;
  }
  .pair .flag:first-child {
    top: 0;
    left: 0;
  }
  .pair .flag:nth-child(2) {
    right: 0;
    bottom: 0;
    box-shadow: 0 0 0 1px var(--border-strong), 0 0 0 3px var(--bg-card);
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px;
  }
  .grid .flag {
    width: 100%;
    height: 100%;
  }
  .grid .more {
    font-size: calc(var(--size) * 0.2);
  }
  .public {
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--accent-muted);
    color: var(--accent);
  }
</style>
