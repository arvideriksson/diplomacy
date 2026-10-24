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

  // movement
  /** A movement draft is open. */
  export let drafting: boolean = false
  /** Order type of the unit being drafted. */
  export let draftType: OrderType | undefined = undefined
  export let draftLabel: string = ''
  export let draftTypes: OrderType[] = []
  export let currentStep: Step | null = null
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
  export let onSetType: (t: OrderType) => void
  export let onDisband: () => void
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
    <!-- per-phase entry header -->
    {#if phase === 'movement'}
      {#if drafting}
        <div class="panel-head">
          <strong>{draftLabel}</strong>
          <button class="link" on:click={onCancel}>Cancel</button>
        </div>
        <div class="type-row">
          {#each draftTypes as t}
            <button class="type" class:active={draftType === t} on:click={() => onSetType(t)}>
              {t}<kbd>{t[0]}</kbd>
            </button>
          {/each}
        </div>
        {#if currentStep?.kind === 'province'}
          <p class="prompt">{currentStep.prompt} — click a highlighted region (or this unit to hold)</p>
          {#each choiceNotes(currentStep.choices) as [note, names]}
            <p class="choice-note"><strong>{note}:</strong> {names}</p>
          {/each}
        {/if}
      {:else}
        <p class="prompt">
          Click a unit — it defaults to <strong>Move</strong>. Then <kbd>S</kbd> support,
          <kbd>C</kbd> convoy, <kbd>H</kbd> hold (or click the unit again to hold).
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
        <p class="prompt">Click a highlighted province to retreat there, or:</p>
        <div class="type-row">
          <button class="type" on:click={onDisband}>Disband</button>
        </div>
      {:else}
        <p class="prompt">Click a highlighted dislodged unit to retreat or disband it.</p>
      {/if}
    {:else if phase === 'build'}
      {#if buildingAt}
        <div class="panel-head">
          <strong>Build at {buildingAt}</strong>
          <button class="link" on:click={onCancel}>Cancel</button>
        </div>
        <p class="prompt">Pick a unit type from the card on the map.</p>
      {:else}
        <p class="prompt">{buildPrompt}</p>
      {/if}
    {/if}

    {#if orders.length}
      <ul class="orders">
        {#each orders as o (orderSource(o))}
          <li>
            <span>{format(o)}</span>
            <button class="link" on:click={() => onDelete(orderSource(o))}>✕</button>
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
  .type-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
  }
  .type-row .type {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border: 1px solid var(--border-strong, #bbb);
    border-radius: 6px;
    background: var(--bg-input, #fff);
    color: var(--text, #1a1a1a);
    cursor: pointer;
    font-size: 13px;
  }
  .type-row .type.active {
    background: var(--accent, #3b82f6);
    color: #fff;
    border-color: var(--accent, #3b82f6);
  }
  kbd {
    font: 11px/1 ui-monospace, monospace;
    padding: 1px 4px;
    border-radius: 3px;
    border: 1px solid var(--border-strong, rgba(0, 0, 0, 0.2));
    background: var(--bg-hover, rgba(0, 0, 0, 0.06));
    color: var(--text-secondary, #5c5c5c);
  }
  /* On the selected (accent) button the hint needs to read against the blue fill. */
  .type-row .type.active kbd {
    border-color: rgba(255, 255, 255, 0.5);
    background: rgba(255, 255, 255, 0.25);
    color: #fff;
  }
  .orders {
    list-style: none;
    margin: 12px 0 0;
    padding: 10px 0 0;
    border-top: 1px solid var(--border, #eee);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .orders li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-variant-numeric: tabular-nums;
  }
</style>
