<script lang="ts">
  // Supply-center standings as a row in the order sidebar / Orders tab, folded to its
  // header until opened. Hovering a power spotlights its centers on the map.
  import type { PowerDefinition } from '../lib/mapDefinition'
  import { scCountByNation } from '../lib/adjudicator/state'
  import { flagUrl } from '../lib/flags'
  import { sameNation } from '../lib/powers'

  /** Powers to show, in map order. */
  export let powers: PowerDefinition[] = []
  /** Supply-center ownership (province → nation), from the board snapshot. */
  export let supplyCenters: Record<string, string> = {}
  /** The viewer's nation — its row is shaded in the power color. Empty = none. */
  export let nation: string = ''
  /** Hovering a row spotlights that nation's supply centers on the map (null = clear). */
  export let onHover: ((nation: string | null) => void) | null = null

  const isMine = (id: string): boolean => !!nation && sameNation(id, nation)

  // Delegate hover for the whole card: spotlight the row under the pointer. Clearing is
  // deferred so the 2px sliver between rows doesn't flash the whole board on its way to
  // the next row — a real move onto the header/padding still clears after the delay.
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

  // 18 of 34 centers wins a standard game; harmless elsewhere as a progress hint.
  const WIN = 18

  $: counts = scCountByNation(supplyCenters)
  // Standings: most centers first, ties broken by map order for stability.
  $: rows = powers
    .map((p) => ({ ...p, count: counts[p.id] ?? 0 }))
    .sort((a, b) => b.count - a.count)
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_mouse_events_have_key_events -->
<div class="sc-card" class:collapsed on:mouseover={handleOver} on:mouseleave={clearNow}>
  <button class="sc-head" on:click={toggle} aria-expanded={!collapsed} title={collapsed ? 'Show standings' : 'Collapse'}>
    <span>Supply Centers</span>
    <svg class="chevron" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 6l4 4 4-4" />
    </svg>
  </button>
  {#if !collapsed}
  <ul class="sc-rows">
    {#each rows as p (p.id)}
      <li
        class="sc-row"
        class:eliminated={p.count === 0}
        class:winner={p.count >= WIN}
        class:mine={isMine(p.id)}
        style="--c:{p.color}"
        data-nation={p.id}
      >
        <span class="stripe" style="background:{p.color}"></span>
        <img class="flag" src={flagUrl[p.id]} alt="" width="22" height="22" />
        <span class="name">{p.name}</span>
        <span class="count">{p.count}</span>
      </li>
    {/each}
  </ul>
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
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    min-height: 40px;
    padding: 10px 14px;
    font-family: inherit;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
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
  .chevron {
    flex: none;
    width: 16px;
    height: 16px;
    color: var(--text-tertiary);
    transition: transform 0.15s ease;
  }
  .sc-card.collapsed .chevron {
    transform: rotate(-90deg);
  }
  .sc-rows {
    list-style: none;
    margin: 0;
    padding: 0 6px 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .sc-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 0 8px 0 0;
    border-radius: 8px;
    overflow: hidden;
    transition: background 0.1s ease;
  }
  .sc-row:hover {
    background: var(--bg-hover, rgba(0, 0, 0, 0.05));
  }
  .stripe {
    flex: none;
    width: 5px;
    align-self: stretch;
  }
  .flag {
    flex: none;
    width: 22px;
    height: 22px;
    display: block;
  }
  .name {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    color: var(--text, #1a1a1a);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .count {
    flex: none;
    min-width: 20px;
    text-align: right;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--c);
  }
  /* The viewer's own nation, shaded in its color. */
  .sc-row.mine {
    background: color-mix(in srgb, var(--c) 16%, transparent);
  }
  .sc-row.mine:hover {
    background: color-mix(in srgb, var(--c) 24%, transparent);
  }
  .sc-row.mine .name {
    font-weight: 700;
  }
  /* Knocked-out powers fade back; the leader-at-victory gets a gold ring. */
  .sc-row.eliminated {
    opacity: 0.45;
  }
  .sc-row.winner {
    background: color-mix(in srgb, var(--amber) 18%, transparent);
  }
</style>
