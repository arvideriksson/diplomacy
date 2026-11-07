<script lang="ts">
  // Supply-center standings as a row in the order sidebar / Orders tab, folded to its
  // header until opened. Hovering a power spotlights its centers on the map. Flat
  // "ledger" rows: flush to the sidebar's edges, hairline dividers, a square color edge.
  import type { MapDefinition } from '../lib/mapDefinition'
  import { scCountByNation, supplyCenterProvinces } from '../lib/adjudicator/state'
  import { victoryThreshold } from '../lib/adjudicator/resolve'
  import Flag from './Flag.svelte'
  import Icon from './Icon.svelte'
  import { sameNation } from '../lib/powers'

  /** The board's map: its powers (in map order), centers and victory rule. */
  export let map: MapDefinition
  /** Supply-center ownership (province → nation), from the board snapshot. */
  export let supplyCenters: Record<string, string> = {}
  /** The viewer's nation — its row is shaded in the power color. Empty = none. */
  export let nation: string = ''
  /** Hovering a row spotlights that nation's supply centers on the map (null = clear). */
  export let onHover: ((nation: string | null) => void) | null = null

  const isMine = (id: string): boolean => !!nation && sameNation(id, nation)

  // Delegate hover for the whole card: spotlight the row under the pointer. Clearing is
  // deferred so moving between rows doesn't flash the whole board on the way to the
  // next row — a real move onto the header/footer still clears after the delay.
  let clearTimer: ReturnType<typeof setTimeout> | null = null
  function clearNow() {
    if (clearTimer) { clearTimeout(clearTimer); clearTimer = null }
    onHover?.(null)
  }
  function handleOver(e: MouseEvent) {
    const id = (e.target as HTMLElement).closest('.sc-row')?.getAttribute('data-nation') ?? null
    if (id) {
      if (clearTimer) { clearTimeout(clearTimer); clearTimer = null }
      onHover?.(id)
    } else if (!clearTimer) {
      clearTimer = setTimeout(() => { clearTimer = null; onHover?.(null) }, 90)
    }
  }

  let collapsed = true
  function toggle() {
    collapsed = !collapsed
    if (collapsed) clearNow() // clear any spotlight when folding away
  }

  // The same target the adjudicator applies, so the header can't disagree with a result.
  $: win = victoryThreshold(map)
  $: strict = !!map.rules?.strictVictory
  $: total = supplyCenterProvinces(map).length
  $: counts = scCountByNation(supplyCenters)
  // Standings: most centers first, ties broken by map order for stability.
  $: rows = map.powers
    .map((p) => ({ ...p, count: counts[p.id] ?? 0 }))
    .sort((a, b) => b.count - a.count)
  $: unowned = Math.max(0, total - rows.reduce((n, p) => n + p.count, 0))
  $: goalTitle = strict
    ? `A power wins with ${win} of ${total} supply centers, if no other power has as many`
    : `A power wins with ${win} of ${total} supply centers`
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_mouse_events_have_key_events -->
<div class="sc-card" class:collapsed on:mouseover={handleOver} on:mouseleave={clearNow}>
  <button class="sc-head" on:click={toggle} aria-expanded={!collapsed} title={collapsed ? 'Show standings' : 'Collapse'}>
    <span class="title">Supply Centers</span>
    <span class="goal" title={goalTitle}><b>{win}</b> to win{#if strict}, sole lead{/if}</span>
    <span class="chevron"><Icon name="chevron-down" size={16} strokeWidth={3} round /></span>
  </button>
  {#if !collapsed}
    <ul class="sc-rows">
      {#each rows as p (p.id)}
        <li
          class="sc-row"
          class:eliminated={p.count === 0}
          class:winner={p.count >= win}
          class:mine={isMine(p.id)}
          style="--c:{p.color}"
          data-nation={p.id}
        >
          <span class="edge"></span>
          <Flag powers={map} nation={p.id} size={22} />
          <span class="name">{p.name}</span>
          <span class="count">{p.count}</span>
        </li>
      {/each}
    </ul>
    <div class="sc-foot">
      <span>Unowned</span>
      <span class="count">{unowned}</span>
    </div>
  {/if}
</div>

<style>
  .sc-card {
    font-size: 14px;
    user-select: none;
  }
  /* The fold row, lit on hover like the Sandbox / End the game rows beside it. */
  .sc-head {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 40px;
    padding: 10px 14px;
    font-family: inherit;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    text-align: left;
    color: var(--text-secondary);
    background: none;
    border: none;
    cursor: pointer;
  }
  @media (hover: hover) {
    .sc-head:hover {
      background: var(--bg-hover);
    }
  }
  .title {
    flex: 1;
    min-width: 0;
  }
  .goal {
    flex: none;
    font-size: 12px;
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
    color: var(--text-tertiary);
  }
  .goal b {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--text-secondary);
  }
  .chevron {
    flex: none;
    display: flex;
    color: var(--text-tertiary);
    transition: transform 0.15s ease;
  }
  .sc-card.collapsed .chevron {
    transform: rotate(-90deg);
  }
  .sc-rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  /* Flush rows split by hairlines; the color edge runs the full row height. */
  .sc-row {
    display: grid;
    grid-template-columns: 3px 22px minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 11px;
    height: 38px;
    padding-right: 14px;
    border-top: 1px solid var(--border);
    transition: background 0.1s ease;
  }
  .sc-row:hover {
    background: var(--bg-hover);
  }
  .edge {
    align-self: stretch;
    background: var(--c);
    box-shadow: inset 0 0 0 1px var(--power-edge-line);
  }
  .name {
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .count {
    min-width: 22px;
    text-align: right;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .sc-row .count {
    font-size: 15px;
    color: var(--text);
  }
  /* The viewer's own nation, shaded in its color. */
  .sc-row.mine {
    background: color-mix(in srgb, var(--c) 12%, transparent);
  }
  .sc-row.mine:hover {
    background: color-mix(in srgb, var(--c) 18%, transparent);
  }
  .sc-row.mine .name {
    font-weight: 700;
  }
  /* Knocked-out powers recede; a power at the win target gets an amber wash. */
  .sc-row.eliminated .name,
  .sc-row.eliminated .count {
    color: var(--text-tertiary);
  }
  .sc-row.eliminated :global(.flag) {
    opacity: 0.4;
    filter: grayscale(1);
  }
  .sc-row.winner {
    background: color-mix(in srgb, var(--amber) 16%, transparent);
  }
  .sc-foot {
    display: flex;
    justify-content: space-between;
    padding: 8px 14px 10px;
    border-top: 1px solid var(--border);
    font-size: 12px;
    color: var(--text-tertiary);
  }
  .sc-foot .count {
    font-weight: 500;
  }
</style>
