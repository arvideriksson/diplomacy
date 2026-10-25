<script lang="ts">
  import { updateGame, updateGameSettings, setDeadline, forceResolve, revertTo, DEFAULT_SETTINGS } from '../lib/game'
  import type { GameState, PhaseTimers } from '../lib/game'
  import { actionRunner } from '../lib/action'
  import { isOrderPhase, PHASE_LABEL } from '../lib/phases'
  import { toLocalInput } from '../lib/time'
  import InfoTip from './InfoTip.svelte'
  import Modal from './Modal.svelte'
  import PacingSettings from './PacingSettings.svelte'

  export let game: GameState
  export let onClose: () => void = () => {}
  /** Bubble the updated game row up so the board/deadline reflect changes at once. */
  export let onGameUpdate: (g: GameState) => void = () => {}
  /** Rounds already resolved, oldest first — the targets a revert can roll back to. */
  export let pastRounds: { year: number; season: string; phase: string }[] = []

  let error = ''
  let saving = false

  $: isActive = isOrderPhase(game.phase)
  $: phaseTimers = game.settings?.phase_timers ?? DEFAULT_SETTINGS.phase_timers
  $: gracePeriod = game.settings?.grace_period ?? null
  $: earlyResolution = game.settings?.early_resolution ?? DEFAULT_SETTINGS.early_resolution
  let nameField = game.name
  $: nameField = game.name

  // Every action reports failure inline and locks the controls while in flight.
  const attempt = actionRunner((m) => (error = m))
  async function busy<T>(fn: () => Promise<T>): Promise<T | undefined> {
    saving = true
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

  // ── Turn actions ─────────────────────────────────────────────────────────────
  // Both run through the adjudicator; the new board arrives via the Realtime push, so
  // the panel closes once the request is accepted.
  const roundLabel = (r: { year: number; season: string; phase: string }) =>
    `${r.season} ${r.year} · ${isOrderPhase(r.phase) ? PHASE_LABEL[r.phase] : r.phase}`

  // Newest first: the usual revert is "undo the last phase".
  $: revertOptions = [...pastRounds].reverse()
  let revertIndex = 0

  async function act(fn: () => Promise<void>) {
    const ok = await busy(async () => (await fn(), true))
    if (ok) onClose()
  }

  function resolveNow() {
    if (!confirm('Resolve this phase now? Powers that haven’t submitted will hold.')) return
    act(() => forceResolve(game.id))
  }

  function revert() {
    const target = revertOptions[revertIndex]
    if (!target) return
    const msg =
      `Revert the game to ${roundLabel(target)}? Every later phase is erased and ` +
      `players’ orders for that phase reopen as unsubmitted drafts. This can’t be undone.`
    if (!confirm(msg)) return
    act(() => revertTo(game.id, target))
  }

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
</script>

<Modal title="Manage game" maxWidth="460px" {onClose}>
  {#if error}<p class="form-error">{error}</p>{/if}

  <div class="setting-group">
    <span class="setting-label">Turn<InfoTip text="Revert rolls the game back to the start of the chosen phase, erasing later phases. Resolve now ends the current phase immediately; powers that have not submitted hold." /></span>
    <div class="action-row">
      {#if revertOptions.length}
        <select class="input" bind:value={revertIndex} disabled={saving}>
          {#each revertOptions as r, i (i)}
            <option value={i}>{roundLabel(r)}</option>
          {/each}
        </select>
        <button class="btn btn-danger" on:click={revert} disabled={saving}>Revert</button>
      {/if}
      {#if isActive}
        <button class="btn" on:click={resolveNow} disabled={saving}>Resolve now</button>
      {/if}
    </div>
  </div>

  {#if isActive}
    <div class="setting-group">
      <label class="setting-label" for="admin-game-name">Game name</label>
      <input
        id="admin-game-name"
        class="input"
        bind:value={nameField}
        on:blur={saveName}
        on:keydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        disabled={saving}
      />
    </div>

    <div class="setting-group">
      <span class="setting-label">Override deadline<InfoTip text="When the current phase is due, in your local time. If anyone still hasn't submitted by then, the phase waits for them (grace period)." /></span>
      <input
        type="datetime-local"
        class="input"
        aria-label="Deadline"
        value={deadlineInput}
        on:change={(e) => applyDeadline(e.currentTarget.value)}
        disabled={saving}
      />
      <div class="quick-row">
        <button class="pill" on:click={() => shiftDeadline(-3600_000)} disabled={saving}>−1h</button>
        <button class="pill" on:click={() => shiftDeadline(3600_000)} disabled={saving}>+1h</button>
        <button class="pill" on:click={() => shiftDeadline(24 * 3600_000)} disabled={saving}>+1 day</button>
      </div>
    </div>

    <PacingSettings
      timers={phaseTimers}
      grace={gracePeriod}
      {earlyResolution}
      disabled={saving}
      midGame
      onTimersChange={saveTimers}
      onGraceChange={saveGrace}
      onEarlyChange={toggleEarly}
    />
  {/if}
</Modal>

<style>
  .action-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 8px;
  }

  .action-row select {
    flex: 1;
  }

  .setting-group > .input {
    margin-top: 4px;
  }

  .quick-row {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }

  @media (max-width: 600px) {
    .action-row {
      flex-wrap: wrap;
    }

    .action-row select {
      flex-basis: 100%;
    }

    .action-row .btn {
      flex: 1;
    }

    .quick-row .pill {
      flex: 1;
    }
  }
</style>
