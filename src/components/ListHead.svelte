<script lang="ts">
  // A section heading in the order sidebar: optional power chip, title and count pill,
  // plus slotted trailing actions. Shared by the to-do lists, the entered orders and the
  // per-country history so every group reads the same.
  export let title: string
  export let count: number | null = null
  /** The country this group belongs to, shown as a chip in its colour. */
  export let power: { name: string; color: string } | null = null
  /** Something still to do: amber. */
  export let todo: boolean = false
  /** Settled (e.g. the submitted set): green. */
  export let done: boolean = false
</script>

<h4 class="list-head" class:todo class:done>
  {#if power}<span class="power-chip" style="--c: {power.color}">{power.name}</span>{/if}
  {title}
  {#if count !== null}<span class="count">{count}</span>{/if}
  <slot />
</h4>

<style>
  .list-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 14px 0 4px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .count {
    font-variant-numeric: tabular-nums;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--bg-hover);
  }
  .todo {
    color: var(--amber);
  }
  .todo .count {
    background: var(--amber-subtle);
  }
  .done {
    color: var(--green, #059669);
  }
  .power-chip {
    /* Full name; ellipsis only if the heading itself runs out of room. */
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 2px 7px;
    border-radius: 999px;
    letter-spacing: 0;
    text-transform: none;
    color: var(--c);
    background: color-mix(in srgb, var(--c) 16%, transparent);
  }
</style>
