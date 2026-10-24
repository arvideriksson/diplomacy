<script lang="ts">
  // Lobby "Game Settings" card: pacing, variant and the toggle settings. Presentational —
  // the lobby owns the values and persists each change through the callbacks.
  import type { PhaseTimers } from '../lib/game'
  import { maps } from '../lib/maps'
  import PacingSettings from './PacingSettings.svelte'
  import ToggleSetting from './ToggleSetting.svelte'
  import Icon from './Icon.svelte'

  /** Only the host may change settings. */
  export let isAdmin: boolean
  /** The map can only be chosen before the game starts. */
  export let canChooseMap: boolean
  export let timers: PhaseTimers
  export let grace: number | null
  export let earlyResolution: boolean
  export let mapId: string
  export let gunboat: boolean
  export let spectators: boolean
  export let randomNations: boolean
  export let isPrivate: boolean
  /** The host-controls toggle's value. */
  export let hostControls: boolean
  /** Host controls are on for the game (it must then stay private). */
  export let hostControlsLocked: boolean

  export let onTimersChange: (t: PhaseTimers) => void
  export let onGraceChange: (v: number | null) => void
  export let onEarlyChange: (v: boolean) => void
  export let onMapChange: (mapId: string) => void
  export let onGunboatChange: (v: boolean) => void
  export let onSpectatorsChange: (v: boolean) => void
  export let onRandomNationsChange: (v: boolean) => void
  export let onTogglePrivate: () => void
  export let onHostControlsChange: (v: boolean) => void

  // Variant = which board to play. Derived from the map registry, so adding a map
  // here makes it selectable automatically.
  const MAP_OPTIONS = Object.values(maps).map((m) => ({
    value: m.id,
    label: m.name,
  }))
</script>

<section class="card">
  <div class="card-head">
    <Icon name="gear" />
    <h2>Game Settings</h2>
  </div>

  <PacingSettings
    {timers}
    {grace}
    {earlyResolution}
    disabled={!isAdmin}
    {onTimersChange}
    {onGraceChange}
    {onEarlyChange}
  />

  <div class="setting-group">
    <span class="setting-label">Variant</span>
    <div class="variant-options">
      {#each MAP_OPTIONS as opt}
        <button
          class="variant-card"
          class:active={mapId === opt.value}
          disabled={!canChooseMap}
          on:click={() => onMapChange(opt.value)}
        >
          <span class="variant-name">{opt.label}</span>
        </button>
      {/each}
    </div>
  </div>

  <ToggleSetting
    label="Gunboat"
    tip="No press: players cannot chat or negotiate."
    checked={gunboat}
    disabled={!isAdmin}
    onChange={onGunboatChange}
  />
  <ToggleSetting
    label="Allow spectators"
    checked={spectators}
    disabled={!isAdmin}
    onChange={onSpectatorsChange}
  />
  <ToggleSetting
    label="Random nation assignment"
    tip="Powers are dealt at random when the game starts."
    checked={randomNations}
    disabled={!isAdmin}
    onChange={onRandomNationsChange}
  />
  <ToggleSetting
    label="Public"
    tip={hostControlsLocked ? 'Turn off host controls to make the game public.' : ''}
    checked={!isPrivate}
    disabled={!isAdmin || hostControlsLocked}
    onChange={onTogglePrivate}
  />
  <ToggleSetting
    label="Host controls"
    tip="The host can revert turns, resolve phases early and change the deadline and timers mid-game. Fixed once the game starts. Private games only."
    checked={hostControls}
    disabled={!isAdmin || !isPrivate}
    onChange={onHostControlsChange}
  />
</section>

<style>
  .variant-options {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 8px;
  }

  .variant-card {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 14px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    cursor: pointer;
    text-align: left;
    transition: all 0.12s;
    font-family: var(--font);
  }

  .variant-card:hover:not(:disabled) {
    border-color: var(--border-strong);
  }

  .variant-card.active {
    border-color: var(--accent);
    background: var(--accent-subtle);
  }

  .variant-card:disabled {
    cursor: default;
    opacity: 0.65;
  }

  .variant-card.active:disabled {
    opacity: 1;
  }

  .variant-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
  }
</style>
