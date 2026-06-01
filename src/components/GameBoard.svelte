<script lang="ts">
  import type { Unit } from '../lib/game'
  import type { MapDefinition } from '../lib/mapDefinition'
  import DiplomacyMap from './DiplomacyMap.svelte'
  import { toDsvgId, toGameId } from '../lib/map/idMap'
  import type { Order, OrderType } from '../lib/orders/types'
  import {
    nextStep,
    finalize,
    toOrderStates,
    type Draft,
    type Step,
    type WizardContext,
  } from '../lib/orders/wizard'

  export let mapDef: MapDefinition
  export let units: Unit[] = []
  export let ownership: Record<string, string> = {}
  /** The viewer's nation; order entry is limited to their units. Empty = view only. */
  export let nation: string = ''

  let orders: Order[] = []
  let draft: Draft | null = null
  let currentStep: Step | null = null

  const matchesNation = (u: Unit): boolean =>
    !nation || u.nation.toLowerCase() === nation.toLowerCase()

  $: ownUnits = units.filter(matchesNation)

  function context(d: Draft): WizardContext | null {
    const unit = units.find((u) => u.territory === d.source && (u.coast ?? '') === (d.sourceCoast ?? ''))
    return unit ? { map: mapDef, unit, units } : null
  }

  // Advance the wizard after any draft change; auto-commit when complete.
  function recompute() {
    if (!draft) {
      currentStep = null
      return
    }
    const ctx = context(draft)
    if (!ctx) {
      draft = null
      currentStep = null
      return
    }
    const step = nextStep(draft, ctx)
    if (step.kind === 'done') {
      commit(ctx)
    } else {
      currentStep = step
    }
  }

  function commit(ctx: WizardContext) {
    if (!draft) return
    const order = finalize(draft, ctx)
    orders = [...orders.filter((o) => o.source !== order.source), order]
    draft = null
    currentStep = null
  }

  function startDraft(unit: Unit) {
    draft = { source: unit.territory, sourceCoast: unit.coast }
    recompute()
  }

  function chooseOrderType(type: OrderType) {
    if (!draft) return
    draft = { ...draft, type }
    recompute()
  }

  function applyProvince(dsvgId: string) {
    if (!draft || currentStep?.kind !== 'province') return
    const choice = currentStep.choices.find((c) => toDsvgId(c.id, c.coast) === dsvgId)
    if (!choice) return
    if (currentStep.field === 'target') draft = { ...draft, target: choice.id }
    else if (currentStep.field === 'coast') draft = { ...draft, targetCoast: choice.coast }
    else if (currentStep.field === 'aux') draft = { ...draft, aux: choice.id }
    recompute()
  }

  function handleProvinceClick(dsvgId: string) {
    if (!draft) {
      const gameId = toGameId(dsvgId)
      const unit = ownUnits.find((u) => u.territory === gameId)
      if (unit) startDraft(unit)
      return
    }
    applyProvince(dsvgId)
  }

  function cancel() {
    draft = null
    currentStep = null
  }

  function deleteOrder(source: string) {
    orders = orders.filter((o) => o.source !== source)
  }

  // ── map inputs derived from wizard state ──────────────────────────────
  $: highlighted =
    currentStep?.kind === 'province'
      ? currentStep.choices.map((c) => toDsvgId(c.id, c.coast))
      : []

  $: selectable = !draft
    ? ownUnits.map((u) => toDsvgId(u.territory, u.coast))
    : currentStep?.kind === 'province'
      ? highlighted
      : [] // order-type step: choose via the panel

  $: renderOrders = toOrderStates(orders)

  const provinceName = (id: string): string => mapDef.territories[id]?.name ?? id
  $: draftUnit = draft ? units.find((u) => u.territory === draft!.source) : undefined
  $: draftLabel = draftUnit
    ? `${draftUnit.type === 'fleet' ? 'Fleet' : 'Army'} ${provinceName(draft!.source)}`
    : ''
</script>

<div class="board">
  <DiplomacyMap
    {mapDef}
    {units}
    {ownership}
    orders={renderOrders}
    {highlighted}
    {selectable}
    onProvinceClick={nation ? handleProvinceClick : null}
  />

  {#if nation}
    <div class="panel">
      {#if draft && currentStep}
        <div class="panel-head">
          <strong>{draftLabel}</strong>
          <button class="link" on:click={cancel}>Cancel</button>
        </div>
        {#if currentStep.kind === 'orderType'}
          <p class="prompt">{currentStep.prompt}</p>
          <div class="choices">
            {#each currentStep.orderTypes as t}
              <button on:click={() => chooseOrderType(t)}>{t}</button>
            {/each}
          </div>
        {:else if currentStep.kind === 'province'}
          <p class="prompt">{currentStep.prompt} — click a highlighted region</p>
          <div class="choices">
            {#each currentStep.choices as c}
              <button on:click={() => applyProvince(toDsvgId(c.id, c.coast))}>{c.label}</button>
            {/each}
          </div>
        {/if}
      {:else}
        <p class="prompt">Click one of your units to give it an order.</p>
      {/if}

      {#if orders.length}
        <ul class="orders">
          {#each orders as o (o.source)}
            <li>
              <span>{summarize(o)}</span>
              <button class="link" on:click={() => deleteOrder(o.source)}>✕</button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>

<script context="module" lang="ts">
  import type { Order as OrderT } from '../lib/orders/types'
  // Module-scope so the markup can call it without re-creating per instance.
  export function summarize(o: OrderT): string {
    const c = o.targetCoast ? `(${o.targetCoast})` : ''
    switch (o.type) {
      case 'Hold':
        return `${o.source} holds`
      case 'Move':
        return `${o.source} → ${o.target}${c}`
      case 'Support':
        return o.target && o.target !== o.aux
          ? `${o.source} S ${o.aux} → ${o.target}`
          : `${o.source} S ${o.aux}`
      case 'Convoy':
        return `${o.source} C ${o.aux} → ${o.target}`
    }
  }
</script>

<style>
  .board {
    position: relative;
  }
  .panel {
    margin-top: 12px;
    padding: 12px 14px;
    border: 1px solid var(--border, #ddd);
    border-radius: 8px;
    background: var(--bg-card, #fff);
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
  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .choices button {
    padding: 5px 10px;
    border: 1px solid var(--border-strong, #bbb);
    border-radius: 6px;
    background: var(--bg, #f7f7f7);
    cursor: pointer;
    font-size: 13px;
  }
  .choices button:hover {
    border-color: var(--accent, #3b82f6);
  }
  .link {
    background: none;
    border: none;
    color: var(--accent, #3b82f6);
    cursor: pointer;
    font-size: 13px;
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
