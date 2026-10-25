<script lang="ts">
  // A sandbox on the game board: every power under your command, phases resolved
  // instantly in the browser. Used standalone (/sandbox/:id) and inside a game's view,
  // where it is a copy of that game's board you can leave or delete at any time.
  import { onDestroy } from 'svelte'
  import type { MapDefinition } from '../lib/mapDefinition'
  import GameBoard from './GameBoard.svelte'
  import VictoryBanner from './VictoryBanner.svelte'
  import Icon from './Icon.svelte'
  import { powerName } from '../lib/powers'
  import {
    resolveCurrent,
    setCurrentOrders,
    goBack,
    goForward,
    deleteSandbox,
    type Sandbox,
  } from '../lib/sandbox'
  import { victoryFor, type AnyOrder, type OrderResult } from '../lib/adjudicator'
  import type { Unit } from '../lib/game'
  import { formatAnyOrder, describeAnyOrder } from '../lib/orders/notation'
  import { compact, type GameTab } from '../lib/layout'

  export let sandbox: Sandbox
  export let map: MapDefinition
  /** Leave the sandbox (kept) — back to its game, or to the menu when standalone. */
  export let onExit: () => void
  /** Called after the sandbox is deleted (it no longer exists). */
  export let onDeleted: () => void
  export let pressBadge: number = 0
  export let tab: GameTab = 'map'
  /** Open the map on this nation's units (the viewer's, in a game copy). */
  export let focusNation: string = ''

  $: sb = sandbox
  $: frame = sb.frames[sb.cursor]
  $: board = frame.board
  // The game is over once the board shows a winner; the sandbox then becomes read-only.
  $: winner = victoryFor(map, board.supplyCenters)
  $: inGame = Boolean(sb.origin)

  let lastResults: OrderResult[] = []
  // Board state from just BEFORE the last resolution — needed to render results in
  // notation (unit types for the A/F prefix; dislodged units for retreats).
  let preUnits: Unit[] = []
  let preDislodged: Array<{ unit: Unit }> = []

  // A short summary on the map after each resolution; the full list is in Orders.
  let notice = ''
  let noticeTimer: ReturnType<typeof setTimeout> | null = null
  function flash(text: string) {
    notice = text
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => (notice = ''), 7000)
  }
  onDestroy(() => noticeTimer && clearTimeout(noticeTimer))

  function handleResolve(orders: AnyOrder[]) {
    const label = board.phase === 'build' ? `Winter ${board.year} builds` : `${board.season} ${board.year}${board.phase === 'retreat' ? ' retreats' : ''}`
    preUnits = board.units
    preDislodged = board.dislodged
    const result = resolveCurrent(sb.id, orders)
    lastResults = (result?.results as OrderResult[]) ?? []
    const failed = lastResults.filter((r) => r.code !== 'succeeds').length
    const dislodgedNow = result?.newBoardState.dislodged.length ?? 0
    const parts = [failed ? `${failed} failed` : 'all orders succeeded', dislodgedNow ? `${dislodgedNow} dislodged` : '']
    flash(`Resolved ${label}: ${parts.filter(Boolean).join(', ')}`)
  }
  const handleOrdersChange = (orders: AnyOrder[]) => setCurrentOrders(sb.id, orders)
  function step(fn: (id: string) => void) {
    fn(sb.id)
    lastResults = []
    notice = ''
  }
  function handleDelete() {
    deleteSandbox(sb.id)
    onDeleted()
  }

  // Successful holds are noise in the results; failures and moves are what you test for.
  $: shownResults = lastResults.filter((r) => r.code !== 'succeeds' || r.order.type !== 'Hold')
  $: hiddenHolds = lastResults.length - shownResults.length


  const src = (r: OrderResult): string => (r.order as { source: string }).source
</script>

<GameBoard
  mapDef={map}
  bind:tab
  onExit={onExit}
  exitLabel={inGame ? 'Game' : ''}
  title={sb.origin?.gameName ?? sb.name}
  gameId=""
  units={board.units}
  ownership={board.supplyCenters}
  nation=""
  phase={board.phase}
  season={board.season}
  year={board.year}
  controlAll={true}
  onResolve={handleResolve}
  initialOrders={frame.orders ?? []}
  historyResults={frame.results ?? []}
  onOrdersChange={handleOrdersChange}
  seedKey={`${sb.id}|${sb.cursor}`}
  onPhaseBack={() => step(goBack)}
  onPhaseForward={() => step(goForward)}
  canPhaseBack={sb.cursor > 0}
  canPhaseForward={sb.cursor < sb.frames.length - 1}
  dislodged={board.dislodged}
  contested={board.contested}
  supplyCenters={board.supplyCenters}
  readOnly={Boolean(winner)}
  {pressBadge}
  {focusNation}
  {notice}
  leftWidth="320px"
>
  <svelte:fragment slot="left">
    <div class="no-press">
      {#if inGame}
        <button class="btn btn-primary" on:click={onExit}>‹ Back to the game</button>
      {:else}
        <p>No press in a sandbox — you are playing every power.</p>
      {/if}
    </div>
  </svelte:fragment>

  <svelte:fragment slot="map-action">
    {#if !$compact}
      <button class="glass exit-btn" on:click={onExit}>‹ {inGame ? 'Back to game' : 'Leave'}</button>
    {/if}
    <button class="glass exit-btn icon trash" on:click={handleDelete} aria-label="Delete sandbox" title="Delete sandbox">
      <Icon name="trash" size={17} round />
    </button>
  </svelte:fragment>

  <svelte:fragment slot="toolbar">
    <div class="sb-banner">
      <span class="sb-tag">Sandbox</span>
      <span class="sb-name">{inGame ? `copied at ${sb.name}` : sb.name}</span>
    </div>
  </svelte:fragment>

  <svelte:fragment slot="results">
    {#if winner || lastResults.length}
      <div class="results-stack">
        {#if winner}
          <VictoryBanner winner={{ name: powerName(map.powers, winner.nation), centers: winner.centers }} />
        {/if}
        {#if lastResults.length}
          <div class="glass results">
            <h4>Last resolution</h4>
            <ul>
              {#each shownResults as r (src(r) + r.code)}
                <li class:fail={r.code !== 'succeeds'}>
                  <div class="r-line">
                    <span class="r-order">{describeAnyOrder(map, r.order)}<span class="r-nota">{formatAnyOrder(map, preUnits, preDislodged, r.order)}</span></span>
                    <span class="r-code">{r.code}</span>
                  </div>
                  {#if r.code !== 'succeeds'}
                    <div class="r-reason">{r.reason}</div>
                  {/if}
                </li>
              {/each}
            </ul>
            {#if hiddenHolds}<p class="r-more">+ {hiddenHolds} successful hold{hiddenHolds === 1 ? '' : 's'}</p>{/if}
          </div>
        {/if}
      </div>
    {/if}
  </svelte:fragment>

</GameBoard>

<style>
  .no-press {
    margin: auto;
    padding: 24px;
    max-width: 340px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    text-align: center;
    color: var(--text-secondary);
  }
  .no-press p {
    margin: 0;
  }
  .exit-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 36px;
    padding: 0 12px 0 10px;
    border-radius: 999px;
    color: var(--text);
    font: 600 13px var(--font);
    cursor: pointer;
  }
  .exit-btn + .exit-btn {
    margin-left: 8px;
  }
  .exit-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
  .exit-btn.icon {
    width: 38px;
    height: 38px;
    padding: 0;
    justify-content: center;
  }
  .exit-btn.trash {
    color: var(--red);
  }
  .exit-btn.trash:hover {
    color: var(--red);
    border-color: var(--red);
  }
  .r-more {
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--text-tertiary);
  }
  .sb-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .sb-tag {
    flex: none;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    padding: 2px 7px;
    border-radius: 999px;
    background: var(--amber);
    color: #fff;
  }
  .sb-name {
    font-weight: 600;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Last-resolution results — flows in the sidebar below the order panel. */
  .results-stack {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  /* .glass, with a lighter shadow: it sits in the sidebar, not over the map. */
  .results {
    padding: 10px 12px;
    border-radius: 10px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
    font-size: 13px;
  }
  .results h4 {
    margin: 0 0 6px;
    font-size: 13px;
  }
  .results ul {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 38vh;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .results li {
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
    display: flex;
    flex-direction: column;
  }
  .r-nota {
    font: 400 11px var(--mono);
    color: var(--text-tertiary);
  }
  .r-code {
    color: var(--text-secondary, #777);
    font-size: 12px;
  }
  .results li.fail .r-code {
    color: #b45309;
  }
  .r-reason {
    font-size: 11px;
    color: var(--text-tertiary, #8c8c8c);
  }
</style>
