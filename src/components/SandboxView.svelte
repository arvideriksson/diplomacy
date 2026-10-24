<script lang="ts">
  import { victoryMessage } from '../lib/mapDefinition'
  import { classicalMap } from '../lib/maps/classical'
  import { getMap } from '../lib/maps'
  import GameBoard from './GameBoard.svelte'
  import {
    sandboxes,
    resolveCurrent,
    setCurrentOrders,
    goBack,
    goForward,
    resetSandbox,
    deleteSandbox,
    exportSandbox,
    type Sandbox,
  } from '../lib/sandbox'
  import { victoryFor, type AnyOrder, type OrderResult } from '../lib/adjudicator'
  import type { Unit } from '../lib/game'
  import { formatAnyOrder } from '../lib/orders/notation'
  import { onDestroy } from 'svelte'
  import { immersive } from '../lib/layout'

  export let sandboxId: string
  export let onBack: () => void = () => {}

  // Sandboxes claim the full viewport (no header), like the active board.
  immersive.set(true)
  onDestroy(() => immersive.set(false))

  $: sb = $sandboxes.find((s) => s.id === sandboxId) as Sandbox | undefined
  $: map = sb ? getMap(sb.mapId) : classicalMap
  $: frame = sb ? sb.frames[sb.cursor] : undefined
  $: board = frame?.board
  // The game is over once the board shows a winner; the sandbox then becomes read-only.
  $: winner = board ? victoryFor(map, board.supplyCenters) : undefined
  $: canBack = sb ? sb.cursor > 0 : false
  $: canForward = sb ? sb.cursor < sb.frames.length - 1 : false

  let lastResults: OrderResult[] = []
  // Board state from just BEFORE the last resolution — needed to render results in
  // notation (unit types for the A/F prefix; dislodged units for retreats).
  let preUnits: Unit[] = []
  let preDislodged: Array<{ unit: Unit }> = []

  function handleResolve(orders: AnyOrder[]) {
    if (!sb || !board) return
    preUnits = board.units
    preDislodged = board.dislodged
    const result = resolveCurrent(sb.id, orders)
    lastResults = (result?.results as OrderResult[]) ?? []
  }
  function handleOrdersChange(orders: AnyOrder[]) {
    if (sb) setCurrentOrders(sb.id, orders)
  }
  function handleBackPhase() {
    if (sb) goBack(sb.id)
    lastResults = []
  }
  function handleForwardPhase() {
    if (sb) goForward(sb.id)
    lastResults = []
  }
  function handleReset() {
    if (sb && confirm('Reset this sandbox to the opening position?')) {
      resetSandbox(sb.id)
      lastResults = []
      }
  }
  function handleDelete() {
    if (sb && confirm('Delete this sandbox?')) {
      deleteSandbox(sb.id)
      onBack()
    }
  }
  function handleExport() {
    if (sb) navigator.clipboard?.writeText(exportSandbox(sb.id))
  }

  const src = (r: OrderResult): string => (r.order as { source: string }).source
</script>

{#if !sb || !board}
  <div class="missing">
    <p>This sandbox no longer exists.</p>
    <button on:click={onBack}>Back</button>
  </div>
{:else}
  <div class="sandbox-stage">
  <GameBoard
    mapDef={map}
    onExit={onBack}
    title={sb.name}
    gameId=""
    units={board.units}
    ownership={board.supplyCenters}
    nation=""
    phase={board.phase}
    season={board.season}
    year={board.year}
    controlAll={true}
    onResolve={handleResolve}
    initialOrders={frame?.orders ?? []}
    onOrdersChange={handleOrdersChange}
    seedKey={String(sb.cursor)}
    onPhaseBack={handleBackPhase}
    onPhaseForward={handleForwardPhase}
    canPhaseBack={canBack}
    canPhaseForward={canForward}
    dislodged={board.dislodged}
    contested={board.contested}
    supplyCenters={board.supplyCenters}
    readOnly={Boolean(winner)}
  >
    <svelte:fragment slot="toolbar">
      <button class="tool" on:click={handleReset}>Reset</button>
      <button class="tool" on:click={handleExport}>Copy JSON</button>
      <button class="tool danger" on:click={handleDelete}>Delete</button>
    </svelte:fragment>

    <svelte:fragment slot="results">
      {#if winner || lastResults.length}
        <div class="results-stack">
          {#if winner}
            <div class="card victory">{victoryMessage(map.powers, winner)}</div>
          {/if}
          {#if lastResults.length}
            <div class="card results">
              <h4>Last resolution</h4>
              <ul>
                {#each lastResults as r (src(r) + r.code)}
                  <li class:fail={r.code !== 'succeeds'}>
                    <div class="r-line">
                      <span class="r-order">{formatAnyOrder(map, preUnits, preDislodged, r.order)}</span>
                      <span class="r-code">{r.code}</span>
                    </div>
                    {#if r.code !== 'succeeds'}
                      <div class="r-reason">{r.reason}</div>
                    {/if}
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>
      {/if}
    </svelte:fragment>
  </GameBoard>
  </div>
{/if}

<style>
  .sandbox-stage {
    position: relative;
    height: 100%;
  }
  .missing {
    max-width: 600px;
    margin: 80px auto;
    text-align: center;
  }
  .tool {
    padding: 4px 9px;
    border: 1px solid var(--border-strong, #cbd5e1);
    border-radius: 6px;
    background: var(--bg-input, #fff);
    color: var(--text, #1a1a1a);
    cursor: pointer;
    font-size: 12px;
  }
  .tool:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .tool.danger {
    color: #dc2626;
    border-color: #f3b4b4;
  }
  /* Last-resolution results — flows in the sidebar below the order panel. */
  .results-stack {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .card {
    padding: 10px 12px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--bg-card, #fff) 94%, transparent);
    backdrop-filter: blur(10px) saturate(1.4);
    -webkit-backdrop-filter: blur(10px) saturate(1.4);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
    font-size: 13px;
  }
  .card.victory {
    background: #fef9c3;
  }
  .card.results h4 {
    margin: 0 0 6px;
    font-size: 13px;
  }
  .card.results ul {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 38vh;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .card.results li {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .r-line {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }
  .r-order {
    font-weight: 600;
  }
  .r-code {
    color: var(--text-secondary, #777);
    font-size: 12px;
  }
  .card.results li.fail .r-code {
    color: #b45309;
  }
  .r-reason {
    font-size: 11px;
    color: var(--text-tertiary, #8c8c8c);
  }
</style>
