<script lang="ts">
  // The order sidebar's panel: in history mode the resolved orders; while the viewer can
  // act, the per-phase entry prompt (movement wizard, retreat or build) and the entered
  // orders, followed by the slotted footer (submit controls). Presentational — every
  // state change goes back to the board through the callbacks.
  import type { AnyOrder, OrderType } from '../lib/orders/types'
  import type { Step } from '../lib/orders/wizard'
  import { choiceNotes, orderSource } from '../lib/orders/board'

  /** History view of a past phase: just the resolved orders, no entry. */
  export let readOnly: boolean = false
  /** The viewer may enter orders this phase. */
  export let canAct: boolean = false
  export let phase: string
  /** The resolved orders shown in history mode. */
  export let historyOrders: AnyOrder[] = []
  /** The orders entered so far this phase. */
  export let orders: AnyOrder[] = []
  export let format: (o: AnyOrder) => string
  /** Plain-language form, shown above the notation in the entry list. */
  export let describe: ((o: AnyOrder) => string) | null = null

  // movement
  /** A movement draft is open. */
  export let drafting: boolean = false
  /** Order type of the unit being drafted. */
  export let draftType: OrderType | undefined = undefined
  export let draftLabel: string = ''
  export let currentStep: Step | null = null
  /** Own units still without an order (movement), each a jump to the map. */
  export let unordered: Array<{ source: string; label: string }> = []
  export let onPickUnit: (source: string) => void = () => {}
  /** A caveat to show under an order (e.g. a support that won't count), or ''. */
  export let warn: (o: AnyOrder) => string = () => ''
  /** God mode: label each order with its power (name + colour). */
  export let powerOf: ((o: AnyOrder) => { name: string; color: string }) | null = null
  /** Tap an entered order to change it on the map. */
  export let onEdit: (source: string) => void = () => {}
  // retreat
  export let hasDislodged: boolean = false
  /** A dislodged unit is selected for routing. */
  export let retreating: boolean = false
  export let retreatLabel: string = ''
  // build
  /** Name of the center whose unit type is being picked; null when none. */
  export let buildingAt: string | null = null
  export let buildPrompt: string = ''

  export let onCancel: () => void
  export let onDelete: (source: string) => void
</script>

{#if readOnly}
  <div class="panel">
    {#if historyOrders.length}
      <ul class="orders">
        {#each historyOrders as o, i (i)}
          <li><span>{format(o)}</span></li>
        {/each}
      </ul>
    {:else}
      <p class="prompt">No orders were submitted this phase.</p>
    {/if}
  </div>
{:else if canAct}
  <div class="panel">
    <!-- per-phase entry prompt; the choices themselves are bubbles on the map -->
    {#if phase === 'movement'}
      {#if drafting}
        <div class="panel-head">
          <strong>{draftLabel}{draftType ? ` · ${draftType}` : ''}</strong>
          <button class="link" on:click={onCancel}>Cancel</button>
        </div>
        {#if currentStep?.kind === 'province'}
          <p class="prompt">{currentStep.prompt}.</p>
          {#each choiceNotes(currentStep.choices) as [note, names]}
            <p class="choice-note"><strong>{note}:</strong> {names}</p>
          {/each}
        {:else}
          <p class="prompt">Choose an order from the bubbles on the map.</p>
        {/if}
      {:else}
        <p class="prompt">
          Select a unit on the map, then pick <strong>Hold</strong>, <strong>Move</strong>,
          <strong>Support</strong> or <strong>Convoy</strong> from the bubbles around it.
          <span class="keys">Keys: <kbd>H</kbd> <kbd>M</kbd> <kbd>S</kbd> <kbd>C</kbd>, <kbd>Esc</kbd> cancels.</span>
        </p>
      {/if}
    {:else if phase === 'retreat'}
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
      {#if buildingAt}
        <div class="panel-head">
          <strong>Build in {buildingAt}</strong>
          <button class="link" on:click={onCancel}>Cancel</button>
        </div>
        <p class="prompt">Pick a unit type from the bubbles on the map.</p>
      {:else}
        <p class="prompt">{buildPrompt}</p>
      {/if}
    {/if}

    {#if unordered.length}
      <h4 class="list-head todo">Needs an order <span>{unordered.length}</span></h4>
      <ul class="orders">
        {#each unordered as u (u.source)}
          <li>
            <button class="row-btn" on:click={() => onPickUnit(u.source)}>
              <span class="dot"></span>
              <span class="row-text">{u.label}</span>
              <span class="go">Order ›</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if orders.length}
      <h4 class="list-head">Your orders <span>{orders.length}</span></h4>
      <ul class="orders">
        {#each orders as o (orderSource(o))}
          <li>
            <button class="row-btn edit" on:click={() => onEdit(orderSource(o))} title="Change this order">
              {#if powerOf}
                {@const p = powerOf(o)}
                <span class="power-chip" style="--c: {p.color}">{p.name}</span>
              {/if}
              <span class="row-text">
                {#if describe}
                  <span class="plain">{describe(o)}</span>
                  <span class="nota">{format(o)}</span>
                  {#if warn(o)}<span class="warn">⚠ {warn(o)}</span>{/if}
                {:else}
                  {format(o)}
                {/if}
              </span>
            </button>
            <button class="del" on:click={() => onDelete(orderSource(o))} aria-label="Delete order">✕</button>
          </li>
        {/each}
      </ul>
    {/if}

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
  .choice-note {
    margin: 4px 0 0;
    font-size: 12.5px;
    color: var(--text-secondary, #555);
  }
  kbd {
    font: 11px/1 ui-monospace, monospace;
    padding: 1px 4px;
    border-radius: 3px;
    border: 1px solid var(--border-strong, rgba(0, 0, 0, 0.2));
    background: var(--bg-hover, rgba(0, 0, 0, 0.06));
    color: var(--text-secondary, #5c5c5c);
  }
  .keys {
    display: block;
    margin-top: 6px;
    font-size: 12.5px;
  }
  /* Touch screens: no keyboard to hint at. */
  @media (hover: none) {
    .keys {
      display: none;
    }
  }
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
  .list-head span {
    font-variant-numeric: tabular-nums;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--bg-hover);
  }
  .list-head.todo {
    color: var(--amber);
  }
  .list-head.todo span {
    background: var(--amber-subtle);
  }
  .orders {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-card);
    overflow: hidden;
  }
  .orders li {
    display: flex;
    align-items: center;
    min-height: 40px;
    padding-left: 12px;
    font-variant-numeric: tabular-nums;
  }
  .orders li + li {
    border-top: 1px solid var(--border);
  }
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
  .nota {
    font: 12px var(--mono);
    color: var(--text-tertiary);
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
    width: 100%;
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
  .power-chip {
    flex: none;
    max-width: 76px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 2px 7px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    color: var(--c);
    background: color-mix(in srgb, var(--c) 16%, transparent);
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
