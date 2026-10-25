<script lang="ts">
  import type { PhaseTimers, OrderPhase } from '../lib/game'
  import { ORDER_PHASES, PHASE_LABEL } from '../lib/phases'
  import { formatMinutes } from '../lib/time'

  /** Current per-phase durations (minutes). Edits are reported via onChange. */
  export let timers: PhaseTimers
  export let disabled = false
  export let onChange: (timers: PhaseTimers) => void = () => {}
  /** First-phase length (minutes); null = the movement timer. */
  export let firstTurn: number | null = null
  /** Shows the First turn row (lobby only: it means nothing once the game has started). */
  export let onFirstTurnChange: ((v: number | null) => void) | null = null

  const PRESETS: Record<OrderPhase, number[]> = {
    movement: [720, 1440, 2880, 4320, 10080],
    retreat: [360, 720, 1440],
    build: [360, 720, 1440],
  }
  const FIRST_TURN_PRESETS = [2880, 4320, 10080, 20160]
  const PHASES = ORDER_PHASES.map((key) => ({ key, label: PHASE_LABEL[key], presets: PRESETS[key] }))

  const UNITS = [
    { id: 'minutes', label: 'min', factor: 1 },
    { id: 'hours', label: 'hours', factor: 60 },
    { id: 'days', label: 'days', factor: 1440 },
  ] as const
  type UnitId = (typeof UNITS)[number]['id']

  // Local custom-field state, derived from the value but independently editable so the
  // number/unit inputs keep their natural unit while you type.
  type Field = { num: number; unit: UnitId }
  function toField(min: number): Field {
    if (min % 1440 === 0) return { num: min / 1440, unit: 'days' }
    if (min % 60 === 0) return { num: min / 60, unit: 'hours' }
    return { num: min, unit: 'minutes' }
  }

  let fields: Record<OrderPhase | 'first', Field> = {
    movement: toField(timers.movement),
    retreat: toField(timers.retreat),
    build: toField(timers.build),
    first: toField(firstTurn ?? timers.movement),
  }
  // Re-sync the custom fields when timers change from outside (e.g. a realtime update),
  // but not when we ourselves just pushed a change (guarded by lastSync).
  let lastSync = ''
  const syncKey = (t: PhaseTimers, first: number | null) => `${t.movement}|${t.retreat}|${t.build}|${first}`
  $: syncFields(timers, firstTurn)
  function syncFields(t: PhaseTimers, first: number | null) {
    const key = syncKey(t, first)
    if (key === lastSync) return
    lastSync = key
    fields = {
      movement: toField(t.movement),
      retreat: toField(t.retreat),
      build: toField(t.build),
      first: toField(first ?? t.movement),
    }
  }

  function emit() {
    lastSync = syncKey(timers, firstTurn)
    onChange(timers)
  }

  function setFirstTurn(v: number | null) {
    if (disabled || v === firstTurn) return
    firstTurn = v
    fields = { ...fields, first: toField(v ?? timers.movement) }
    lastSync = syncKey(timers, firstTurn)
    onFirstTurnChange?.(v)
  }

  const fieldMinutes = (f: Field) =>
    Math.max(1, Math.round((Number(f.num) || 0) * UNITS.find((u) => u.id === f.unit)!.factor))

  function setPreset(phase: OrderPhase, min: number) {
    if (disabled) return
    timers = { ...timers, [phase]: min }
    fields = { ...fields, [phase]: toField(min) }
    emit()
  }

  function applyCustom(phase: OrderPhase) {
    if (disabled) return
    timers = { ...timers, [phase]: fieldMinutes(fields[phase]) }
    emit()
  }
</script>

<div class="phase-timers">
  {#each PHASES as p (p.key)}
    {@const isCustom = !p.presets.includes(timers[p.key])}
    <div class="timer-row">
      <span class="timer-name">{p.label}</span>
      <div class="timer-opts">
        {#each p.presets as preset (preset)}
          <button
            type="button"
            class="pill"
            class:active={timers[p.key] === preset}
            {disabled}
            on:click={() => setPreset(p.key, preset)}
          >{formatMinutes(preset)}</button>
        {/each}
        <div class="custom" class:active={isCustom}>
          <input
            type="number"
            min="1"
            aria-label="{p.label} custom duration"
            bind:value={fields[p.key].num}
            {disabled}
            on:input={() => applyCustom(p.key)}
          />
          <select
            aria-label="{p.label} custom unit"
            bind:value={fields[p.key].unit}
            {disabled}
            on:change={() => applyCustom(p.key)}
          >
            {#each UNITS as u (u.id)}
              <option value={u.id}>{u.label}</option>
            {/each}
          </select>
        </div>
      </div>
    </div>
  {/each}
  {#if onFirstTurnChange}
    {@const isCustom = firstTurn != null && !FIRST_TURN_PRESETS.includes(firstTurn)}
    <div class="timer-row">
      <span class="timer-name">First turn</span>
      <div class="timer-opts">
        <button type="button" class="pill" class:active={firstTurn == null} {disabled} on:click={() => setFirstTurn(null)}>
          Movement
        </button>
        {#each FIRST_TURN_PRESETS as preset (preset)}
          <button
            type="button"
            class="pill"
            class:active={firstTurn === preset}
            {disabled}
            on:click={() => setFirstTurn(preset)}
          >{formatMinutes(preset)}</button>
        {/each}
        <div class="custom" class:active={isCustom}>
          <input
            type="number"
            min="1"
            aria-label="First turn custom duration"
            bind:value={fields.first.num}
            {disabled}
            on:input={() => setFirstTurn(fieldMinutes(fields.first))}
          />
          <select
            aria-label="First turn custom unit"
            bind:value={fields.first.unit}
            {disabled}
            on:change={() => setFirstTurn(fieldMinutes(fields.first))}
          >
            {#each UNITS as u (u.id)}
              <option value={u.id}>{u.label}</option>
            {/each}
          </select>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .phase-timers {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 10px;
  }

  .timer-row {
    display: grid;
    grid-template-columns: 76px 1fr;
    align-items: center;
    gap: 12px;
  }

  .timer-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .timer-opts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  /* Custom value reads as a single segmented control to match the pills. */
  .custom {
    position: relative;
    display: inline-flex;
    align-items: center;
    height: 30px;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: var(--bg-elevated);
    overflow: hidden;
    transition: border-color 0.12s, background 0.12s;
  }
  /* CSS-triangle chevron so it tracks the theme's --accent without a baked-in SVG color. */
  .custom::after {
    content: '';
    position: absolute;
    right: 10px;
    top: 50%;
    width: 0;
    height: 0;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-top: 5px solid var(--text-secondary);
    transform: translateY(-50%);
    pointer-events: none;
    transition: border-top-color 0.12s;
  }
  .custom.active::after {
    border-top-color: var(--accent);
  }
  .custom.active {
    border-color: var(--accent);
    background: var(--accent-subtle);
  }
  .custom input {
    width: 46px;
    height: 100%;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 13px;
    font-weight: 600;
    text-align: center;
    font-family: var(--font);
    padding: 0;
    -moz-appearance: textfield;
    appearance: textfield;
  }
  .custom input::-webkit-outer-spin-button,
  .custom input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .custom input:focus {
    outline: none;
  }
  .custom select {
    height: 100%;
    border: none;
    border-left: 1px solid var(--border);
    background: transparent;
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 500;
    font-family: var(--font);
    /* Strip the native control chrome; the .custom::after triangle is our chevron. */
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    padding: 0 26px 0 10px;
    cursor: pointer;
  }
  .custom select option {
    color: var(--text);
    background: var(--bg-elevated);
  }
  .custom.active select {
    color: var(--accent);
    border-left-color: color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .custom select:focus {
    outline: none;
  }
  .custom input:disabled,
  .custom select:disabled {
    opacity: 0.65;
    cursor: default;
  }

  /* Phones: the phase name sits above its options so the pills get the full width,
     and the custom field matches the taller pills (16px text: no iOS focus zoom). */
  @media (max-width: 600px) {
    .phase-timers {
      gap: 14px;
    }
    .timer-row {
      grid-template-columns: 1fr;
      gap: 6px;
    }
    .custom {
      height: 36px;
    }
    .custom input,
    .custom select {
      font-size: 16px;
    }
    .custom input {
      width: 48px;
    }
  }
</style>
