<script lang="ts">
  // One order as the sidebar shows it: plain language (the notation in its tooltip; the
  // list's copy button gives the whole set as notation), plus an optional caveat. Shared by the entry list, history and the submitted mirror.
  import type { AnyOrder } from '../lib/orders/types'

  export let order: AnyOrder
  export let format: (o: AnyOrder) => string
  export let describe: ((o: AnyOrder) => string) | null = null
  export let warning: string = ''
</script>

<span class="row-text" title={describe ? format(order) : undefined}>
  {#if describe}
    <span class="plain">{describe(order)}</span>
    {#if warning}<span class="warn">⚠ {warning}</span>{/if}
  {:else}
    {format(order)}
  {/if}
</span>

<style>
  .row-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 6px 0;
  }
  .plain {
    font-weight: 600;
    line-height: 1.3;
  }
  .warn {
    font-size: 12px;
    font-weight: 600;
    color: var(--amber);
  }
</style>
