<script lang="ts">
  // The order sidebar's panel: in history mode the resolved orders; while the viewer can
  // act, the per-phase entry prompt (movement wizard, retreat or build) and the entered
  // orders (submit controls are pinned below it by the board). Presentational — every
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
   * an order (movement), dislodged units without a retreat (retreat), open home centers
   * and units to remove (build). In a sandbox
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
  /** The unit (or center) being ordered on the map right now, highlighted in the lists. */
  export let activeSource: string = ''
  /** What the map is asking for on that unit (e.g. "Choose an order"), shown in its row. */
  export let activeHint: string = ''
  /** Step back from routing to the order types, or null when there's nothing to go back to. */
  export let onActiveBack: (() => void) | null = null
  /** Heading of the entered list ("Your orders", "Submitted orders", "Draft changes"). */
  export let ordersTitle: string = 'Your orders'
  /** Count shown beside that heading; null counts the entered orders. */
  export let ordersCount: number | string | null = null
  /** The list is (a draft of) the submitted set: rows are changed by tapping, not deleted. */
  export let submittedView: boolean = false
  /** After submitting: an entered order that differs from the submitted set. */
  export let changed: (o: AnyOrder) => boolean = () => false
  /** After submitting: a unit's submitted order where the draft differs, described ('' if none). */
  export let was: (id: string) => string = () => ''
  /** Tap an entered order to change it on the map. */
  export let onEdit: (source: string) => void = () => {}
  // retreat
  export let hasDislodged: boolean = false
  // build
  export let buildPrompt: string = ''

  /** The set locked in on the server, mirrored read-only while edits to it are unsent. */
  export let locked: AnyOrder[] = []

  export let onCancel: () => void
  export let onDelete: (source: string) => void
  /** After submitting: restore one changed order to its submitted form. */
  export let onRevert: (source: string) => void = () => {}

  let lockedOpen = false
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

<!-- Under the row being ordered on the map: what the map is waiting for (e.g. a destination). -->
{#snippet detail(changedRow = false)}
  <li class="detail" class:changed-li={changedRow}>
    {#if activeHint}
      <span class="detail-hint">
        {#if onActiveBack}<button class="detail-back" on:click={onActiveBack} aria-label="Back to order types">‹</button>{/if}
        {activeHint}
      </span>
    {/if}
  </li>
{/snippet}

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
          <li class:active-li={u.id === activeSource}>
            <button
              class="row-btn"
              aria-expanded={u.id === activeSource}
              aria-label="{t.go} {u.label}"
              on:click={() => (u.id === activeSource ? onCancel() : onPickTodo(u.id))}
            >
              <span class="dot"></span>
              <span class="row-text">
                {u.label}
                {#if was(u.id)}<span class="was">Submitted: {was(u.id)}</span>{/if}
              </span>
              <span class="go" class:open={u.id === activeSource} aria-hidden="true"><Icon name="chevron-right" size={18} round /></span>
            </button>
          </li>
          {#if u.id === activeSource && activeHint}{@render detail()}{/if}
        {/each}
      </OrderCard>
    {/each}

    {#if orders.length || (copyText && todos.length)}
      <ListHead title={ordersTitle} count={ordersCount ?? orders.filter(entered).length}>
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
          <li class:active-li={orderSource(o) === activeSource} class:changed-li={changed(o)} title={changed(o) ? 'Unsent change' : undefined}>
            <button class="row-btn" class:edit={entered(o) && !submittedView} on:click={() => onEdit(orderSource(o))} title="Change this order">
              <span class="row-main">
                <OrderText order={o} {format} {describe} warning={warn(o)} />
              </span>
            </button>
            {#if entered(o) && !submittedView}
              <!-- Before submitting, drop an order outright. After, a submitted order is
                   changed by tapping it (e.g. to Hold), so no destructive ✕ beside it. -->
              <button class="del" on:click={() => onDelete(orderSource(o))} aria-label="Clear order" title="Clear order — the unit goes back to No order yet">
                <span class="del-x" aria-hidden="true"><Icon name="trash" size={16} round /></span><span class="del-label">Clear</span>
              </button>
            {:else if submittedView && changed(o) && was(orderSource(o))}
              <button class="undo" on:click={() => onRevert(orderSource(o))} aria-label="Undo change" title="Undo change">
                <Icon name="reset" size={16} round />
              </button>
            {/if}
          </li>
          {#if orderSource(o) === activeSource && activeHint}{@render detail(changed(o))}{/if}
        {/each}
      </OrderCard>
    {/each}

    {#if locked.length}
      <!-- What the server actually holds, while the edits above are unsent. -->
      <button class="locked-fold" aria-expanded={lockedOpen} on:click={() => (lockedOpen = !lockedOpen)}>
        <ListHead done title="Submitted orders" count={locked.length}>
          <span class="fold-act">{lockedOpen ? 'Hide' : 'View'}</span>
        </ListHead>
      </button>
      {#if lockedOpen}
        <OrderCard>
          {#each locked as o (orderSource(o))}
            <li><OrderText order={o} {format} {describe} /></li>
          {/each}
        </OrderCard>
      {/if}
    {/if}

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
    margin: 0 4px 0 2px;
    border-radius: 8px;
    border: none;
    background: none;
    color: var(--text-secondary);
    font-size: 14px;
    cursor: pointer;
  }
  .del:hover {
    color: var(--red);
    background: var(--bg-hover);
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
  /* Hovering a row lights the whole line, trailing controls included. */
  @media (hover: hover) {
    li:has(> .row-btn:hover) {
      background: var(--bg-hover);
    }
  }

  /* The unit whose bubbles are open on the map. */
  /* The row being ordered: a neutral lift (blue is kept for unsent changes). */
  li.active-li {
    background: var(--bg-hover);
    box-shadow: inset 3px 0 0 var(--text-tertiary);
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
  /* An unsent change: the whole row in a soft tint of the Resubmit blue. */
  li.changed-li {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  /* Expanded while changed: the editor keeps the tint, with a blue edge. */
  li.changed-li.active-li,
  li.detail.changed-li {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .row-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .was {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-secondary);
  }
  .locked-fold {
    display: block;
    width: 100%;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .undo {
    flex: none;
    width: 40px;
    height: 40px;
    margin: 0 4px 0 2px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 8px;
    background: none;
    color: var(--accent);
    cursor: pointer;
  }
  .undo:hover {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
  .del-label {
    display: none;
  }
  /* Touch: no tooltip to explain a bare ✕, so say what it does. */
  @media (hover: none) {
    .del {
      width: auto;
      height: 44px;
      padding: 0 12px;
      font: 600 13px var(--font);
    }
    .del-x {
      display: none;
    }
    .del-label {
      display: inline;
    }
  }
  .fold-act {
    margin-left: auto;
    letter-spacing: 0;
    text-transform: none;
    font-weight: 600;
    color: var(--accent);
  }
  li.detail {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    padding: 4px 12px 12px;
    background: var(--bg-hover);
    box-shadow: inset 3px 0 0 var(--text-tertiary);
  }
  :global(.orders > li.active-li + li.detail) {
    border-top: none;
  }
  .detail-hint {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--text-secondary);
  }
  .detail-back {
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 6px;
    background: var(--bg-hover);
    color: var(--text);
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
  }
  /* Expands the row's order types; turns down while open. */
  .row-btn .go {
    flex: none;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    color: var(--text-secondary);
    transition: transform 0.15s;
  }
  .row-btn .go.open {
    transform: rotate(90deg);
  }
</style>
