<script lang="ts">
  // The order sidebar's panel: in history mode the resolved orders; while the viewer can
  // act, the per-phase entry prompt (movement wizard, retreat or build) and the entered
  // orders, followed by the slotted footer (submit controls). Presentational — every
  // state change goes back to the board through the callbacks.
  import type { AnyOrder } from '../lib/orders/types'
  import { orderSource } from '../lib/orders/board'
  import Icon from './Icon.svelte'
  import ListHead from './ListHead.svelte'
  import OrderCard from './OrderCard.svelte'
  import OrderText from './OrderText.svelte'

  /** History view of a past phase: just the resolved orders, no entry. */
  export let readOnly: boolean = false
  /** The viewer may enter orders this phase. */
  export let canAct: boolean = false
  export let phase: string
  /** The resolved orders shown in history mode. */
  export let historyOrders: AnyOrder[] = []
  /** The orders listed this phase (in a sandbox, un-ordered units appear as Holds). */
  export let orders: AnyOrder[] = []
  /** Whether a listed order was actually entered (an implicit Hold has nothing to delete). */
  export let entered: (o: AnyOrder) => boolean = () => true
  export let format: (o: AnyOrder) => string
  /** The whole order set as notation (un-ordered units holding), for the copy button. */
  export let copyText: string = ''
  /** Plain-language form, shown above the notation in the entry list. */
  export let describe: ((o: AnyOrder) => string) | null = null

  /**
   * What still needs doing, as groups of rows that each jump to the map: units without
   * an order (movement), open home centers and units to remove (build). In a sandbox
   * each power gets its own group, tagged with `power`.
   */
  export let todos: Array<{
    key: string
    title: string
    count: number
    go: string
    power?: { name: string; color: string }
    items: Array<{ id: string; label: string }>
  }> = []
  export let onPickTodo: (id: string) => void = () => {}
  /** A caveat to show under an order (e.g. a support that won't count), or ''. */
  export let warn: (o: AnyOrder) => string = () => ''
  /** A power's display name and colour, for the per-country groups. */
  export let powerInfo: (nation: string) => { name: string; color: string } = (n) => ({ name: n, color: '#888' })
  /** God mode (sandbox): group the entered orders by power. History is always grouped. */
  export let byPower: boolean = false
  /** Tap an entered order to change it on the map. */
  export let onEdit: (source: string) => void = () => {}
  // retreat
  export let hasDislodged: boolean = false
  /** A dislodged unit is selected for routing. */
  export let retreating: boolean = false
  export let retreatLabel: string = ''
  // build
  export let buildPrompt: string = ''

  export let onCancel: () => void
  export let onDelete: (source: string) => void

  let copied = false
  let copiedTimer: ReturnType<typeof setTimeout> | null = null
  function copyOrders() {
    navigator.clipboard?.writeText(copyText)
    copied = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied = false), 1500)
  }

  // Orders split per country, countries alphabetical by display name.
  const byNation = (list: AnyOrder[]) => {
    const groups = new Map<string, AnyOrder[]>()
    for (const o of list) (groups.get(o.nation) ?? groups.set(o.nation, []).get(o.nation)!).push(o)
    return [...groups]
      .map(([nation, list]) => ({ nation, power: powerInfo(nation), list }))
      .sort((a, b) => a.power.name.localeCompare(b.power.name))
  }
  $: historyGroups = byNation(historyOrders)
  $: orderGroups = byPower ? byNation(orders) : [{ nation: '', power: null, list: orders }]
</script>

{#if readOnly}
  <div class="panel">
    {#if historyOrders.length}
      {#each historyGroups as g (g.nation)}
        <ListHead power={g.power} title="Orders" />
        <OrderCard>
          {#each g.list as o, i (i)}
            <li>
              <OrderText order={o} {format} {describe} />
            </li>
          {/each}
        </OrderCard>
      {/each}
    {:else}
      <p class="prompt">No orders were submitted this phase.</p>
    {/if}
  </div>
{:else if canAct}
  <div class="panel">
    <!-- per-phase entry prompt; the choices themselves are bubbles on the map -->
    {#if phase === 'retreat'}
      {#if !hasDislodged}
        <p class="prompt">No dislodged units — nothing to retreat.</p>
      {:else if retreating}
        <div class="panel-head">
          <strong>{retreatLabel}</strong>
          <button class="link" on:click={onCancel}>Cancel</button>
        </div>
        <p class="prompt">Retreat to a highlighted province, or disband — use the bubbles on the map.</p>
      {:else}
        <p class="prompt">Select a flagged dislodged unit on the map to retreat or disband it.</p>
      {/if}
    {:else if phase === 'build'}
      {#if buildPrompt}
        <p class="prompt">{buildPrompt}</p>
      {/if}
    {/if}

    {#each todos as t (t.key)}
      <ListHead todo power={t.power ?? null} title={t.title} count={t.count} />
      <OrderCard>
        {#each t.items as u (u.id)}
          <li>
            <button class="row-btn" on:click={() => onPickTodo(u.id)}>
              <span class="dot"></span>
              <span class="row-text">{u.label}</span>
              <span class="go">{t.go} ›</span>
            </button>
          </li>
        {/each}
      </OrderCard>
    {/each}

    {#if orders.length || (copyText && todos.length)}
      <ListHead title="Your orders" count={orders.filter(entered).length}>
        {#if copyText}
          <button class="copy" on:click={copyOrders} aria-label="Copy all orders" title={copied ? 'Copied' : 'Copy all orders (un-ordered units hold)'}>
            <Icon name={copied ? 'check' : 'copy'} size={15} round />
          </button>
        {/if}
      </ListHead>
    {/if}
    {#each orders.length ? orderGroups : [] as g (g.nation)}
      {#if g.power}
        <ListHead power={g.power} title="Orders" />
      {/if}
      <OrderCard>
        {#each g.list as o (orderSource(o))}
          <li>
            <button class="row-btn" class:edit={entered(o)} on:click={() => onEdit(orderSource(o))} title="Change this order">
              <OrderText order={o} {format} {describe} warning={warn(o)} />
            </button>
            {#if entered(o)}
              <button class="del" on:click={() => onDelete(orderSource(o))} aria-label="Delete order">✕</button>
            {/if}
          </li>
        {/each}
      </OrderCard>
    {/each}

    <slot />
  </div>
{:else}
  <div class="panel">
    <p class="prompt">Order entry for the {phase} phase isn’t available.</p>
  </div>
{/if}

<style>
  .panel {
    font-size: 14px;
  }
  .panel-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .prompt {
    margin: 0 0 8px;
    color: var(--text-secondary, #555);
  }
  .copy {
    margin-left: auto;
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .copy:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .row-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 6px 0;
  }
  .del {
    flex: none;
    width: 40px;
    height: 40px;
    border: none;
    background: none;
    color: var(--text-tertiary);
    font-size: 14px;
    cursor: pointer;
  }
  .del:hover {
    color: var(--red);
  }
  .row-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    /* Grow rather than width: 100% — the negative margin would leave the right 12px unlit. */
    flex: 1;
    min-width: 0;
    min-height: 40px;
    margin-left: -12px;
    padding: 0 12px;
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row-btn:hover {
    background: var(--bg-hover);
  }
  .row-btn.edit {
    padding-right: 0;
  }
  .row-btn .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--amber);
  }
  .row-btn .go {
    color: var(--accent);
    font-weight: 600;
    font-size: 13px;
  }
</style>
