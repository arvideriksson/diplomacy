<script lang="ts">
  import type { MapDefinition } from '../lib/mapDefinition'
  import type { Unit } from '../lib/game'
  import type { AnyOrder, RetreatOrder } from '../lib/orders/types'
  import { retreatTargets } from '../lib/orders/adjustments'
  import { submitOrders } from '../lib/game'

  export let map: MapDefinition
  export let nation: string
  export let units: Unit[] = []
  export let dislodged: Array<{ unit: Unit; attackedFrom: string }> = []
  export let contested: string[] = []
  export let gameId: string
  export let ready: boolean = false
  /** Sandbox/god mode: retreat every power's dislodged units. */
  export let controlAll: boolean = false
  /** When set (sandbox), resolve locally via this instead of the RPC. */
  export let onResolve: ((orders: AnyOrder[]) => void) | null = null
  /** Sandbox: previously-entered orders for this phase, to preset the selects. */
  export let initialOrders: AnyOrder[] = []
  /** Sandbox: notified when a selection changes (stores it / forks the timeline). */
  export let onOrdersChange: ((orders: AnyOrder[]) => void) | null = null

  // Each option is a concrete (province, coast?) destination, plus a Disband choice.
  interface Choice {
    value: string
    label: string
    province?: string
    coast?: string
  }

  const provinceName = (id: string): string => map.territories[id]?.name ?? id
  const unitLabel = (u: Unit): string =>
    `${u.type === 'fleet' ? 'Fleet' : 'Army'} ${provinceName(u.territory)}${u.coast ? ` (${u.coast})` : ''}`

  $: mine = controlAll ? dislodged : dislodged.filter((d) => d.unit.nation === nation)

  function choicesFor(d: { unit: Unit; attackedFrom: string }): Choice[] {
    const opts: Choice[] = [{ value: 'disband', label: 'Disband' }]
    for (const t of retreatTargets(map, d.unit, d.attackedFrom, units, contested)) {
      if (t.coasts.length > 1) {
        for (const c of t.coasts) {
          opts.push({ value: `${t.province}/${c}`, label: `${provinceName(t.province)} (${c})`, province: t.province, coast: c })
        }
      } else {
        const coast = t.coasts[0]
        opts.push({ value: t.province, label: provinceName(t.province), province: t.province, coast })
      }
    }
    return opts
  }

  // selection keyed by the dislodged unit's province; defaults to 'disband'
  let selection: Record<string, string> = {}
  // Preset from previously-entered orders whenever the phase's orders change.
  let seededRef: AnyOrder[] | null = null
  $: if (initialOrders !== seededRef) {
    seededRef = initialOrders
    const sel: Record<string, string> = {}
    for (const o of initialOrders as RetreatOrder[]) {
      if (!o?.source) continue
      sel[o.source] =
        o.type === 'Disband' ? 'disband' : o.targetCoast ? `${o.target}/${o.targetCoast}` : o.target ?? 'disband'
    }
    selection = sel
  }
  $: for (const d of mine) if (!(d.unit.territory in selection)) selection[d.unit.territory] = 'disband'

  const emitChange = () => onOrdersChange?.(buildOrders())

  function buildOrders(): RetreatOrder[] {
    return mine.map((d) => {
      const chosen = selection[d.unit.territory] ?? 'disband'
      const opts = choicesFor(d)
      const opt = opts.find((o) => o.value === chosen)
      if (!opt || !opt.province) {
        return { type: 'Disband', nation: d.unit.nation, source: d.unit.territory, sourceCoast: d.unit.coast }
      }
      return {
        type: 'Retreat',
        nation: d.unit.nation,
        source: d.unit.territory,
        sourceCoast: d.unit.coast,
        target: opt.province,
        targetCoast: opt.coast,
      }
    })
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
  {#if mine.length === 0}
    <p class="prompt">None of your units were dislodged — nothing to retreat.</p>
  {:else}
    <p class="prompt">Choose a retreat for each dislodged unit (or disband).</p>
    <ul class="rows">
      {#each mine as d (d.unit.territory)}
        <li>
          <span class="unit">{unitLabel(d.unit)}</span>
          <select bind:value={selection[d.unit.territory]} on:change={emitChange}>
            {#each choicesFor(d) as opt (opt.value)}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        </li>
      {/each}
    </ul>
    <div class="actions">
      {#if onResolve}
        <button class="ready on" on:click={resolveLocal}>Resolve retreats</button>
      {:else}
        <button on:click={() => save(false)} disabled={saving}>Save</button>
        <button class="ready" class:on={ready} on:click={() => save(!ready)} disabled={saving}>
          {ready ? 'Ready ✓ — unready' : 'Submit & ready'}
        </button>
        {#if saving}<span class="status">Saving…</span>{/if}
        {#if saveError}<span class="status error">{saveError}</span>{/if}
      {/if}
    </div>
  {/if}
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
