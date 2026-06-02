<script lang="ts">
  import type { MapDefinition } from '../lib/mapDefinition'
  import type { Unit } from '../lib/game'
  import type { AnyOrder, BuildOrder } from '../lib/orders/types'
  import { buildSituation, type BuildSituation } from '../lib/orders/adjustments'
  import { submitOrders } from '../lib/game'

  export let map: MapDefinition
  export let nation: string
  export let units: Unit[] = []
  export let supplyCenters: Record<string, string> = {}
  export let gameId: string
  export let ready: boolean = false
  /** Sandbox/god mode: manage every power's adjustments. */
  export let controlAll: boolean = false
  /** When set (sandbox), resolve locally via this instead of the RPC. */
  export let onResolve: ((orders: AnyOrder[]) => void) | null = null
  /** Sandbox: previously-entered orders for this phase, to preset the controls. */
  export let initialOrders: AnyOrder[] = []
  /** Sandbox: notified when a selection changes (stores it / forks the timeline). */
  export let onOrdersChange: ((orders: AnyOrder[]) => void) | null = null

  const provinceName = (id: string): string => map.territories[id]?.name ?? id

  // Nations to manage: just the viewer's, or all of them in god mode.
  $: nations = controlAll
    ? [...new Set([...units.map((u) => u.nation), ...Object.values(supplyCenters)])].sort()
    : [nation]

  interface Section extends BuildSituation {
    nation: string
  }
  $: sections = nations
    .map((n) => ({ nation: n, ...buildSituation(map, n, supplyCenters, units) }))
    .filter((s) => controlAll ? s.delta !== 0 || s.spots.length || s.removable.length : true) as Section[]

  // selections keyed by province (unique across nations on the board)
  let buildSel: Record<string, string> = {}
  let removeSel: Record<string, boolean> = {}

  // Preset from previously-entered orders whenever the phase's orders change.
  let seededRef: AnyOrder[] | null = null
  $: if (initialOrders !== seededRef) {
    seededRef = initialOrders
    const b: Record<string, string> = {}
    const r: Record<string, boolean> = {}
    for (const o of initialOrders as BuildOrder[]) {
      if (o?.type === 'Build') b[o.source] = o.unitType === 'fleet' ? (o.sourceCoast ? `fleet:${o.sourceCoast}` : 'fleet') : 'army'
      else if (o?.type === 'Remove') r[o.source] = true
    }
    buildSel = b
    removeSel = r
  }

  const emitChange = () => onOrdersChange?.(buildOrders())

  interface BuildOpt {
    value: string
    label: string
  }
  function optionsFor(spot: { types: Array<'army' | 'fleet'>; coasts?: string[] }): BuildOpt[] {
    const opts: BuildOpt[] = [{ value: 'none', label: "Don't build" }]
    if (spot.types.includes('army')) opts.push({ value: 'army', label: 'Army' })
    if (spot.types.includes('fleet')) {
      if (spot.coasts && spot.coasts.length > 1) {
        for (const c of spot.coasts) opts.push({ value: `fleet:${c}`, label: `Fleet (${c})` })
      } else {
        opts.push({ value: 'fleet', label: 'Fleet' })
      }
    }
    return opts
  }

  function buildOrders(): BuildOrder[] {
    const out: BuildOrder[] = []
    for (const sec of sections) {
      if (sec.delta > 0) {
        let built = 0
        for (const spot of sec.spots) {
          const v = buildSel[spot.province]
          if (!v || v === 'none') continue
          if (built >= sec.delta) break
          if (v === 'army') out.push({ type: 'Build', nation: sec.nation, source: spot.province, unitType: 'army' })
          else {
            const coast = v.includes(':') ? v.split(':')[1] : undefined
            out.push({ type: 'Build', nation: sec.nation, source: spot.province, unitType: 'fleet', sourceCoast: coast })
          }
          built++
        }
      } else if (sec.delta < 0) {
        let removed = 0
        for (const u of sec.removable) {
          if (!removeSel[u.territory]) continue
          if (removed >= -sec.delta) break
          out.push({ type: 'Remove', nation: sec.nation, source: u.territory, sourceCoast: u.coast })
          removed++
        }
      }
    }
    return out
  }

  let saving = false
  let saveError = ''
  async function save(markReady: boolean) {
    saving = true
    saveError = ''
    try {
      await submitOrders(gameId, buildOrders(), markReady)
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e)
    } finally {
      saving = false
    }
  }
  function resolveLocal() {
    onResolve?.(buildOrders())
  }
</script>

<div class="panel">
  {#if sections.every((s) => s.delta === 0)}
    <p class="prompt">No adjustments needed — centers and units are balanced.</p>
  {/if}

  {#each sections as sec (sec.nation)}
    {#if controlAll || sec.delta !== 0}
      <div class="section">
        {#if controlAll}
          <div class="section-head">{sec.nation}</div>
        {/if}
        {#if sec.delta > 0}
          <p class="prompt">
            May build <strong>{sec.delta}</strong> (building fewer is allowed).
          </p>
          {#if sec.spots.length === 0}
            <p class="prompt">No open home centers.</p>
          {:else}
            <ul class="rows">
              {#each sec.spots as spot (spot.province)}
                <li>
                  <span class="unit">{provinceName(spot.province)}</span>
                  <select bind:value={buildSel[spot.province]} on:change={emitChange}>
                    {#each optionsFor(spot) as opt (opt.value)}
                      <option value={opt.value}>{opt.label}</option>
                    {/each}
                  </select>
                </li>
              {/each}
            </ul>
          {/if}
        {:else if sec.delta < 0}
          <p class="prompt">
            Must remove <strong>{-sec.delta}</strong> (unpicked are auto-chosen).
          </p>
          <ul class="rows">
            {#each sec.removable as u (u.territory)}
              <li>
                <label>
                  <input type="checkbox" bind:checked={removeSel[u.territory]} on:change={emitChange} />
                  {u.type === 'fleet' ? 'Fleet' : 'Army'} {provinceName(u.territory)}{u.coast ? ` (${u.coast})` : ''}
                </label>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  {/each}

  <div class="actions">
    {#if onResolve}
      <button class="ready on" on:click={resolveLocal}>Resolve builds</button>
    {:else}
      <button on:click={() => save(false)} disabled={saving}>Save</button>
      <button class="ready" class:on={ready} on:click={() => save(!ready)} disabled={saving}>
        {ready ? 'Ready ✓ — unready' : 'Submit & ready'}
      </button>
      {#if saving}<span class="status">Saving…</span>{/if}
      {#if saveError}<span class="status error">{saveError}</span>{/if}
    {/if}
  </div>
</div>

<style>
  .panel {
    margin-top: 12px;
    padding: 12px 14px;
    border: 1px solid var(--border, #ddd);
    border-radius: 8px;
    background: var(--bg-card, #fff);
    font-size: 14px;
  }
  .prompt {
    margin: 0 0 8px;
    color: var(--text-secondary, #555);
  }
  .section + .section {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--border, #eee);
  }
  .section-head {
    font-weight: 700;
    text-transform: capitalize;
    margin-bottom: 4px;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .rows li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  .unit {
    font-weight: 600;
  }
  select {
    padding: 4px 8px;
    border: 1px solid var(--border-strong, #bbb);
    border-radius: 6px;
    font-size: 13px;
    background: var(--bg-input, #fff);
    color: var(--text, #1a1a1a);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--border, #eee);
  }
  .actions button {
    padding: 6px 12px;
    border: 1px solid var(--border-strong, #bbb);
    border-radius: 6px;
    background: var(--bg-input, #fff);
    color: var(--text, #1a1a1a);
    cursor: pointer;
    font-size: 13px;
  }
  .actions button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .actions .ready.on {
    background: var(--accent, #3b82f6);
    color: #fff;
    border-color: var(--accent, #3b82f6);
  }
  .status {
    font-size: 12px;
    color: var(--text-secondary, #777);
  }
  .status.error {
    color: #dc2626;
  }
</style>
