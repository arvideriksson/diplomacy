<script lang="ts">
  // Foot of the orders view, below End the game: the host's controls for a game created
  // with host controls. A ledger of settings rows (label, current value) that each open
  // their editor in place, then the two turn actions with an inline confirm strip.
  import { updateGame, updateGameSettings, setDeadline, forceResolve, revertTo, DEFAULT_SETTINGS } from '../lib/game'
  import type { GameState, PhaseTimers } from '../lib/game'
  import { actionRunner } from '../lib/action'
  import { isOrderPhase, roundLabel } from '../lib/phases'
  import { formatDeadline, formatMinutes, toLocalInput } from '../lib/time'
  import Icon from './Icon.svelte'
  import Toggle from './Toggle.svelte'
  import PhaseTimerSettings from './PhaseTimerSettings.svelte'
  import GracePeriodSetting from './GracePeriodSetting.svelte'

  export let game: GameState
  /** Bubble the updated game row up so the board/deadline reflect changes at once. */
  export let onGameUpdate: (g: GameState) => void = () => {}
  /** Rounds already resolved, oldest first — the targets a revert can roll back to. */
  export let pastRounds: { year: number; season: string; phase: string }[] = []
  /** Folded to its header row until opened (bound: opening loads the revert targets). */
  export let open = false

  let error = ''
  let saving = false

  $: isActive = isOrderPhase(game.phase)
  $: timers = game.settings?.phase_timers ?? DEFAULT_SETTINGS.phase_timers
  $: grace = game.settings?.grace_period ?? null
  $: earlyResolution = game.settings?.early_resolution ?? DEFAULT_SETTINGS.early_resolution
  let nameField = game.name
  $: nameField = game.name

  // One settings row open at a time.
  type Row = 'deadline' | 'timers' | 'grace' | 'name'
  let editing: Row | null = null
  const toggleRow = (r: Row) => (editing = editing === r ? null : r)

  // Every action reports failure inline and locks the controls while in flight.
  const attempt = actionRunner((m) => (error = m))
  async function busy<T>(fn: () => Promise<T>): Promise<T | undefined> {
    saving = true
    error = ''
    try {
      return await attempt(fn)
    } finally {
      saving = false
    }
  }

  async function run(fn: () => Promise<GameState>) {
    const updated = await busy(fn)
    if (updated) onGameUpdate(updated)
  }

  const saveTimers = (t: PhaseTimers) => run(() => updateGameSettings(game.id, { phase_timers: t }))
  const saveGrace = (v: number | null) => run(() => updateGameSettings(game.id, { grace_period: v }))
  const toggleEarly = (on: boolean) => run(() => updateGameSettings(game.id, { early_resolution: on }))
  const saveName = () => {
    if (nameField.trim() && nameField !== game.name) run(() => updateGame(game.id, { name: nameField.trim() }))
  }

  // ── Summaries ────────────────────────────────────────────────────────────────
  const shortFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  $: dueShort = game.deadline ? shortFmt.format(new Date(game.deadline)) : ''
  $: timersSummary = [timers.movement, timers.retreat, timers.build].map((m) => formatMinutes(m)).join(' · ')
  $: graceSummary = grace == null ? `Movement (${formatMinutes(timers.movement)})` : formatMinutes(grace, { zeroLabel: 'Off' })

  // ── Deadline override ────────────────────────────────────────────────────────
  $: deadlineInput = toLocalInput(game.deadline)

  function applyDeadline(value: string) {
    if (!value) return
    const ms = new Date(value).getTime()
    if (Number.isNaN(ms)) return
    run(() => setDeadline(game.id, new Date(ms).toISOString()))
  }
  function shiftDeadline(deltaMs: number) {
    const base = game.deadline ? new Date(game.deadline).getTime() : Date.now()
    run(() => setDeadline(game.id, new Date(base + deltaMs).toISOString()))
  }

  // ── Turn actions ─────────────────────────────────────────────────────────────
  // Both run through the adjudicator; the new board arrives via the Realtime push.

  // Newest first: the usual revert is "undo the last phase".
  $: revertOptions = [...pastRounds].reverse()
  let revertIndex = 0
  $: revertTarget = revertOptions[revertIndex]

  // The turn action awaiting confirmation.
  let confirming: 'resolve' | 'revert' | null = null
  const ask = (what: 'resolve' | 'revert') => (confirming = confirming === what ? null : what)

  async function confirmed() {
    const what = confirming
    const target = revertTarget
    const ok =
      what === 'resolve'
        ? await busy(async () => (await forceResolve(game.id), true))
        : what === 'revert' && target
          ? await busy(async () => (await revertTo(game.id, target), true))
          : false
    if (ok) {
      confirming = null
      revertIndex = 0
    }
  }
</script>

<section class="host" aria-labelledby="host-title">
  <button class="head" type="button" aria-expanded={open} on:click={() => (open = !open)}>
    <h4 id="host-title">Host</h4>
    {#if isActive && dueShort}<span class="sum">Due <b>{dueShort}</b></span>{/if}
    <span class="chevron"><Icon name="chevron-down" size={16} strokeWidth={3} round /></span>
  </button>

  {#if open}
    {#if isActive}
      <button class="row" type="button" aria-expanded={editing === 'deadline'} on:click={() => toggleRow('deadline')}>
        <span class="k">Deadline</span>
        <span class="v">{formatDeadline(game.deadline) || 'None'}</span>
        <span class="row-chev"><Icon name="chevron-down" size={14} strokeWidth={3} round /></span>
      </button>
      {#if editing === 'deadline'}
        <div class="sub">
          <input
            type="datetime-local"
            class="input"
            aria-label="Deadline"
            value={deadlineInput}
            on:change={(e) => applyDeadline(e.currentTarget.value)}
            disabled={saving}
          />
          <div class="quick">
            <button class="pill" on:click={() => shiftDeadline(-3600_000)} disabled={saving}>−1h</button>
            <button class="pill" on:click={() => shiftDeadline(3600_000)} disabled={saving}>+1h</button>
            <button class="pill" on:click={() => shiftDeadline(24 * 3600_000)} disabled={saving}>+1 day</button>
          </div>
        </div>
      {/if}

      <button class="row" type="button" aria-expanded={editing === 'timers'} on:click={() => toggleRow('timers')}>
        <span class="k">Phase timers</span>
        <span class="v">{timersSummary}</span>
        <span class="row-chev"><Icon name="chevron-down" size={14} strokeWidth={3} round /></span>
      </button>
      {#if editing === 'timers'}
        <div class="sub">
          <PhaseTimerSettings {timers} disabled={saving} stacked onChange={saveTimers} />
        </div>
      {/if}

      <button class="row" type="button" aria-expanded={editing === 'grace'} on:click={() => toggleRow('grace')}>
        <span class="k">Grace period</span>
        <span class="v">{graceSummary}</span>
        <span class="row-chev"><Icon name="chevron-down" size={14} strokeWidth={3} round /></span>
      </button>
      {#if editing === 'grace'}
        <div class="sub">
          <GracePeriodSetting value={grace} movement={timers.movement} disabled={saving} onChange={saveGrace} />
        </div>
      {/if}

      <div class="row">
        <span class="k">Early resolution</span>
        <Toggle checked={earlyResolution} disabled={saving} label="Early resolution" onChange={toggleEarly} />
      </div>

      <button class="row" type="button" aria-expanded={editing === 'name'} on:click={() => toggleRow('name')}>
        <span class="k">Name</span>
        <span class="v">{game.name}</span>
        <span class="row-chev"><Icon name="chevron-down" size={14} strokeWidth={3} round /></span>
      </button>
      {#if editing === 'name'}
        <div class="sub">
          <input
            class="input"
            aria-label="Game name"
            bind:value={nameField}
            on:blur={saveName}
            on:keydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            disabled={saving}
          />
        </div>
      {/if}
    {/if}

    {#if isActive || revertOptions.length}
      <div class="acts">
        {#if isActive}
          <button class="btn btn-sm" class:pressed={confirming === 'resolve'} on:click={() => ask('resolve')} disabled={saving}>Resolve now</button>
        {/if}
        {#if revertOptions.length}
          <button class="btn btn-sm btn-danger-outline" class:pressed={confirming === 'revert'} on:click={() => ask('revert')} disabled={saving}>Revert…</button>
        {/if}
      </div>
    {/if}

    {#if confirming === 'resolve'}
      <div class="confirm">
        <p><b>Resolve {roundLabel(game)} now?</b> Powers that haven’t submitted will hold.</p>
        <div class="confirm-acts">
          <button class="btn btn-sm btn-ghost" on:click={() => (confirming = null)} disabled={saving}>Cancel</button>
          <button class="btn btn-sm btn-primary" on:click={confirmed} disabled={saving}>Resolve now</button>
        </div>
      </div>
    {:else if confirming === 'revert' && revertTarget}
      <div class="confirm danger">
        <select class="input" aria-label="Revert to" bind:value={revertIndex} disabled={saving}>
          {#each revertOptions as r, i (i)}
            <option value={i}>{roundLabel(r)}</option>
          {/each}
        </select>
        <p>Every later phase is erased and that phase’s orders reopen as drafts. This can’t be undone.</p>
        <div class="confirm-acts">
          <button class="btn btn-sm btn-ghost" on:click={() => (confirming = null)} disabled={saving}>Cancel</button>
          <button class="btn btn-sm btn-danger" on:click={confirmed} disabled={saving}>Revert</button>
        </div>
      </div>
    {/if}

    {#if error}<p class="msg err">{error}</p>{/if}
  {/if}
</section>

<style>
  .host {
    font-size: 14px;
    border-top: 1px solid var(--border);
  }
  /* The fold row, matching End the game above it. */
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 40px;
    padding: 10px 14px;
    border: none;
    background: none;
    color: var(--text-secondary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  h4 {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .sum {
    flex: none;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-tertiary);
    white-space: nowrap;
  }
  .sum b {
    font-weight: 700;
    color: var(--text-secondary);
  }
  .chevron,
  .row-chev {
    flex: none;
    display: flex;
    color: var(--text-tertiary);
    transform: rotate(-90deg);
    transition: transform 0.15s ease;
  }
  [aria-expanded='true'] > .chevron,
  [aria-expanded='true'] > .row-chev {
    transform: none;
  }

  /* Ledger rows: label left, current value right, hairline between. */
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 42px;
    padding: 8px 14px;
    border: none;
    border-top: 1px solid var(--border);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
  }
  button.row {
    cursor: pointer;
  }
  @media (hover: hover) {
    .head:hover,
    button.row:hover {
      background: var(--bg-hover);
    }
  }
  .row[aria-expanded='true'] {
    background: var(--bg-hover);
  }
  .k {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    white-space: nowrap;
  }
  .v {
    min-width: 0;
    font-size: 13px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-variant-numeric: tabular-nums;
  }
  .sub {
    padding: 2px 14px 12px;
    background: var(--bg-hover);
  }
  .quick {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  .sub :global(.grace-opts),
  .sub :global(.phase-timers) {
    margin-top: 4px;
  }

  /* Turn actions, then the confirm strip that replaces a modal. */
  .acts {
    display: flex;
    gap: 8px;
    padding: 10px 14px 12px;
    border-top: 1px solid var(--border);
  }
  .acts .btn {
    flex: 1;
  }
  .btn-danger-outline {
    color: var(--red);
    border-color: color-mix(in srgb, var(--red) 45%, transparent);
  }
  .btn.pressed {
    background: var(--bg-fill);
  }
  .confirm {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 14px 12px;
    border-top: 1px solid var(--border);
    background: var(--accent-subtle);
  }
  .confirm.danger {
    background: var(--red-subtle);
  }
  .confirm p {
    margin: 0;
    font-size: 13px;
    color: var(--text-secondary);
  }
  .confirm p b {
    color: var(--text);
  }
  .confirm-acts {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .msg {
    margin: 0;
    padding: 10px 14px 12px;
    border-top: 1px solid var(--border);
    font-size: 12.5px;
  }
  .err {
    color: var(--red);
  }

  @media (max-width: 600px) {
    .quick .pill {
      flex: 1;
    }
  }
</style>
