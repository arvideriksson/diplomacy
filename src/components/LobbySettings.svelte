<script lang="ts">
  // The lobby's settings, beside the seats. The host gets square segmented controls in
  // two groups (turn timers, the game); everyone else sees the values read-only.
  // Presentational: the lobby owns the values and persists each change.
  import type { PhaseTimers } from '../lib/game'
  import { maps } from '../lib/maps'
  import { formatMinutes } from '../lib/time'
  import Segmented from './Segmented.svelte'
  import Toggle from './Toggle.svelte'
  import InfoTip from './InfoTip.svelte'
  import { PACING_TIPS } from './PacingSettings.svelte'

  /** Only the host may change settings. */
  export let isAdmin: boolean
  /** The map can only be chosen before the game starts. */
  export let canChooseMap: boolean
  export let timers: PhaseTimers
  /** Minutes the phase waits past its deadline; null = one movement timer. */
  export let grace: number | null
  /** First phase length (minutes); null = the movement timer. */
  export let firstTurn: number | null
  export let earlyResolution: boolean
  export let mapId: string
  export let gunboat: boolean
  export let randomNations: boolean
  export let isPrivate: boolean
  export let hostControls: boolean
  /** Host controls are on for the game (it must then stay private). */
  export let hostControlsLocked: boolean

  export let onTimersChange: (t: PhaseTimers) => void
  export let onGraceChange: (v: number | null) => void
  export let onFirstTurnChange: (v: number | null) => void
  export let onEarlyChange: (v: boolean) => void
  export let onMapChange: (mapId: string) => void
  export let onGunboatChange: (v: boolean) => void
  export let onRandomNationsChange: (v: boolean) => void
  export let onTogglePrivate: () => void
  export let onHostControlsChange: (v: boolean) => void

  const H = 60
  const D = 1440
  const CUSTOM = -1
  const fmt = (min: number) => formatMinutes(min, { zeroLabel: 'Off' })
  const opts = (mins: number[]) => mins.map((m) => ({ value: m, label: fmt(m) }))

  const MOVE_PRESETS = [12 * H, D, 2 * D, 3 * D, 7 * D]
  const ADJUST_PRESETS = [6 * H, 12 * H, D]
  const moveOptions = [...opts(MOVE_PRESETS), { value: CUSTOM, label: 'Custom' }]
  const adjustOptions = [...opts(ADJUST_PRESETS), { value: CUSTOM, label: 'Custom' }]
  const firstOptions = [{ value: null as number | null, label: 'Same' }, ...opts([2 * D, 3 * D, 7 * D, 14 * D])]
  const graceOptions = [{ value: null as number | null, label: 'Moves' }, ...opts([0, 12 * H, D, 2 * D, 7 * D])]
  const mapOptions = Object.values(maps).map((m) => ({ value: m.id, label: m.name }))
  const powerOptions = [
    { value: false, label: 'Players choose' },
    { value: true, label: 'Random' },
  ]

  // A custom timer: shown when the value isn't a preset, or after picking Custom.
  const UNITS = [
    { id: 'hours', label: 'hours', factor: H },
    { id: 'days', label: 'days', factor: D },
  ] as const
  type Unit = (typeof UNITS)[number]['id']
  type Field = { open: boolean; num: number; unit: Unit }
  const toField = (min: number, open: boolean): Field =>
    min % D === 0 ? { open, num: min / D, unit: 'days' } : { open, num: Math.max(1, Math.round(min / H)), unit: 'hours' }
  const fieldMinutes = (f: Field) => Math.max(H, Math.round((Number(f.num) || 0) * UNITS.find((u) => u.id === f.unit)!.factor))

  let moveField = toField(timers.movement, !MOVE_PRESETS.includes(timers.movement))
  let adjustField = toField(timers.retreat, !ADJUST_PRESETS.includes(timers.retreat))
  // Follow outside changes (another tab, a realtime update) unless the field is open.
  $: if (!moveField.open) moveField = toField(timers.movement, false)
  $: if (!adjustField.open) adjustField = toField(timers.retreat, false)
  $: moveValue = moveField.open || !MOVE_PRESETS.includes(timers.movement) ? CUSTOM : timers.movement
  $: adjustValue = adjustField.open || !ADJUST_PRESETS.includes(timers.retreat) ? CUSTOM : timers.retreat

  function pickMove(v: number) {
    if (v === CUSTOM) return (moveField = { ...toField(timers.movement, true) })
    moveField = toField(v, false)
    onTimersChange({ ...timers, movement: v })
  }
  // Retreats and builds share one timer.
  function pickAdjust(v: number) {
    if (v === CUSTOM) return (adjustField = { ...toField(timers.retreat, true) })
    adjustField = toField(v, false)
    onTimersChange({ ...timers, retreat: v, build: v })
  }
  const applyMove = () => onTimersChange({ ...timers, movement: fieldMinutes(moveField) })
  const applyAdjust = () => {
    const v = fieldMinutes(adjustField)
    onTimersChange({ ...timers, retreat: v, build: v })
  }

  // Read-only summary for everyone but the host.
  const long = (min: number) => {
    if (min === 0) return 'Off'
    if (min % D === 0) return min === D ? '1 day' : `${min / D} days`
    if (min % H === 0) return min === H ? '1 hour' : `${min / H} hours`
    return `${min} minutes`
  }
  $: summary = [
    ['Moves', long(timers.movement)],
    ['Retreats and builds', timers.retreat === timers.build ? long(timers.retreat) : `${long(timers.retreat)} / ${long(timers.build)}`],
    ['First turn', firstTurn == null ? 'Same as moves' : long(firstTurn)],
    ['Grace period', grace == null ? `${long(timers.movement)} (same as moves)` : long(grace)],
    ['Early resolution', earlyResolution ? 'On' : 'Off'],
    ['Map', maps[mapId]?.name ?? mapId],
    ['Powers', randomNations ? 'Random' : 'Players choose'],
    ['Press', gunboat ? 'None (gunboat)' : 'Full'],
    ['Public', isPrivate ? 'No' : 'Yes'],
    ['Host controls', hostControls ? 'On' : 'Off'],
  ]
</script>

{#if isAdmin}
  <section>
    <h2>Turn timers</h2>
    <div class="list">
      <div class="setting">
        <span class="label">Moves</span>
        <Segmented label="Moves" options={moveOptions} value={moveValue} onChange={pickMove} />
        {#if moveValue === CUSTOM}
          <div class="custom">
            <input class="input" type="number" min="1" bind:value={moveField.num} on:change={applyMove} aria-label="Moves, custom length" />
            <select class="input" bind:value={moveField.unit} on:change={applyMove} aria-label="Unit">
              {#each UNITS as u (u.id)}<option value={u.id}>{u.label}</option>{/each}
            </select>
          </div>
        {/if}
      </div>
      <div class="setting">
        <span class="label">Retreats and builds</span>
        <Segmented label="Retreats and builds" options={adjustOptions} value={adjustValue} onChange={pickAdjust} />
        {#if adjustValue === CUSTOM}
          <div class="custom">
            <input class="input" type="number" min="1" bind:value={adjustField.num} on:change={applyAdjust} aria-label="Retreats and builds, custom length" />
            <select class="input" bind:value={adjustField.unit} on:change={applyAdjust} aria-label="Unit">
              {#each UNITS as u (u.id)}<option value={u.id}>{u.label}</option>{/each}
            </select>
          </div>
        {/if}
      </div>
      <div class="setting">
        <span class="label">First turn</span>
        <Segmented label="First turn" options={firstOptions} value={firstTurn} onChange={onFirstTurnChange} />
      </div>
      <div class="setting">
        <span class="label">Grace period<InfoTip text={PACING_TIPS.grace} /></span>
        <Segmented label="Grace period" options={graceOptions} value={grace} onChange={onGraceChange} />
      </div>
      <div class="setting line">
        <span class="label">Early resolution</span>
        <Toggle checked={earlyResolution} label="Early resolution" onChange={onEarlyChange} />
      </div>
    </div>
  </section>

  <section>
    <h2>Game</h2>
    <div class="list">
      <div class="setting">
        <span class="label">Map</span>
        <Segmented label="Map" options={mapOptions} value={mapId} disabled={!canChooseMap} onChange={onMapChange} />
      </div>
      <div class="setting">
        <span class="label">Powers</span>
        <Segmented label="Powers" options={powerOptions} value={randomNations} onChange={onRandomNationsChange} />
      </div>
      <div class="setting line">
        <span class="label">Gunboat<InfoTip text="Press is disabled." /></span>
        <Toggle checked={gunboat} label="Gunboat" onChange={onGunboatChange} />
      </div>
      <div class="setting line">
        <span class="label">Public{#if hostControlsLocked}<span class="hint">off while host controls are on</span>{/if}</span>
        <Toggle checked={!isPrivate} label="Public" disabled={hostControlsLocked} onChange={onTogglePrivate} />
      </div>
      <div class="setting line">
        <span class="label">Host controls<InfoTip text="Revert, force-resolve and change timers mid-game. Private games only." /></span>
        <Toggle checked={hostControls} label="Host controls" disabled={!isPrivate} onChange={onHostControlsChange} />
      </div>
    </div>
  </section>
{:else}
  <section>
    <h2>Settings</h2>
    <div class="list">
      {#each summary as [k, v] (k)}
        <div class="kv"><span>{k}</span><b>{v}</b></div>
      {/each}
    </div>
  </section>
{/if}

<style>
  section {
    display: flex;
    flex-direction: column;
  }
  h2 {
    margin: 0;
    padding: 0 2px 8px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .list {
    background: var(--bg-card);
    border: 1px solid var(--border);
  }
  .setting {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
    border-top: 1px solid var(--border);
  }
  .setting:first-child,
  .kv:first-child {
    border-top: none;
  }
  .setting.line {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .label {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--text);
  }
  .hint {
    display: block;
    margin-top: 1px;
    font-size: 12px;
    font-weight: 400;
    color: var(--text-tertiary);
  }
  .custom {
    display: flex;
    gap: 8px;
  }
  .custom input {
    width: 90px;
  }
  .custom select {
    width: auto;
  }
  .kv {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    min-height: 42px;
    padding: 0 14px;
    border-top: 1px solid var(--border);
    font-size: 13.5px;
  }
  .kv span {
    color: var(--text-secondary);
  }
  .kv b {
    font-weight: 600;
    text-align: right;
  }
</style>
