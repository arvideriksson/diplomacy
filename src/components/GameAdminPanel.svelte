<script lang="ts">
  import { updateGame, updateGameSettings, setDeadline, DEFAULT_SETTINGS } from '../lib/game'
  import type { GameState, PhaseTimers } from '../lib/game'
  import { errorMessage } from '../lib/errors'
  import PhaseTimerSettings from './PhaseTimerSettings.svelte'
  import Modal from './Modal.svelte'
  import ToggleSwitch from './ToggleSwitch.svelte'

  export let game: GameState
  export let onClose: () => void = () => {}
  /** Bubble the updated game row up so the board/deadline reflect changes at once. */
  export let onGameUpdate: (g: GameState) => void = () => {}

  let error = ''
  let saving = false

  $: locked = !game.is_private
  $: phaseTimers = game.settings?.phase_timers ?? DEFAULT_SETTINGS.phase_timers
  $: earlyResolution = game.settings?.early_resolution ?? DEFAULT_SETTINGS.early_resolution
  $: spectators = game.settings?.allow_spectators ?? DEFAULT_SETTINGS.allow_spectators
  let nameField = game.name
  $: nameField = game.name

  async function run(fn: () => Promise<GameState>) {
    error = ''
    saving = true
    try {
      onGameUpdate(await fn())
    } catch (e) {
      error = errorMessage(e)
    } finally {
      saving = false
    }
  }

  const saveTimers = (t: PhaseTimers) => run(() => updateGameSettings(game.id, { phase_timers: t }))
  const toggleEarly = (e: Event) =>
    run(() => updateGameSettings(game.id, { early_resolution: (e.target as HTMLInputElement).checked }))
  const toggleSpectators = (e: Event) =>
    run(() => updateGameSettings(game.id, { allow_spectators: (e.target as HTMLInputElement).checked }))
  const saveName = () => {
    if (nameField.trim() && nameField !== game.name) run(() => updateGame(game.id, { name: nameField.trim() }))
  }

  // ── Deadline override ────────────────────────────────────────────────────────
  const pad = (n: number) => String(n).padStart(2, '0')
  function toLocalInput(iso: string | null | undefined): string {
    if (!iso) return ''
    const d = new Date(iso)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
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

<Modal title="Manage game" {onClose} maxWidth={460}>
  {#if error}<p class="error">{error}</p>{/if}

  {#if locked}
    <p class="locked-note">
      Settings and the deadline are locked for public games once they start, to keep play fair.
      Make a game private to manage it in progress.
    </p>
  {:else}
    <div class="group">
      <span class="label">Game name</span>
      <input
        class="name-input"
        bind:value={nameField}
        on:blur={saveName}
        on:keydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        disabled={saving}
      />
    </div>

    <div class="group">
      <span class="label">Override deadline</span>
      <p class="desc">Set when the current phase auto-resolves (your local time).</p>
      <div class="deadline-row">
        <input
          type="datetime-local"
          value={deadlineInput}
          on:change={(e) => applyDeadline(e.currentTarget.value)}
          disabled={saving}
        />
      </div>
      <div class="quick-row">
        <button class="chip" on:click={() => shiftDeadline(-3600_000)} disabled={saving}>−1h</button>
        <button class="chip" on:click={() => shiftDeadline(3600_000)} disabled={saving}>+1h</button>
        <button class="chip" on:click={() => shiftDeadline(24 * 3600_000)} disabled={saving}>+1 day</button>
      </div>
    </div>

    <div class="group">
      <span class="label">Phase timers</span>
      <p class="desc">Applies to phases opened from the next resolution onward.</p>
      <PhaseTimerSettings timers={phaseTimers} disabled={saving} onChange={saveTimers} />
    </div>

    <div class="group toggle-group">
      <div>
        <span class="label">Early resolution</span>
        <p class="desc">Resolve as soon as every power has submitted</p>
      </div>
      <ToggleSwitch checked={earlyResolution} on:change={toggleEarly} disabled={saving} />
    </div>

    <div class="group toggle-group">
      <div>
        <span class="label">Allow spectators</span>
        <p class="desc">Non-players can watch the game</p>
      </div>
      <ToggleSwitch checked={spectators} on:change={toggleSpectators} disabled={saving} />
    </div>
  {/if}
</Modal>

<style>
  .error {
    color: var(--red);
    background: var(--red-subtle);
    border-radius: var(--radius-sm);
    padding: 8px 10px;
    font-size: 13px;
    margin: 4px 0 0;
  }

  .locked-note {
    font-size: 14px;
    color: var(--text-secondary);
    background: var(--bg-elevated);
    border: 1px dashed var(--border);
    border-radius: var(--radius-md);
    padding: 14px;
    margin: 12px 0 0;
  }

  .group {
    padding: 16px 0;
    border-top: 1px solid var(--border);
  }
  .group:first-of-type {
    border-top: none;
  }

  .label {
    display: block;
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
  }

  .desc {
    font-size: 13px;
    color: var(--text-tertiary);
    margin: 2px 0 0;
  }

  .name-input {
    width: 100%;
    margin-top: 8px;
    padding: 8px 10px;
    font-size: 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
    color: var(--text);
    font-family: var(--font);
  }
  .name-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .deadline-row {
    margin-top: 8px;
  }
  .deadline-row input {
    width: 100%;
    padding: 8px 10px;
    font-size: 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
    color: var(--text);
    font-family: var(--font);
  }
  .deadline-row input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .quick-row {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  .chip {
    padding: 5px 12px;
    font-size: 13px;
    font-weight: 500;
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-secondary);
    cursor: pointer;
    font-family: var(--font);
    transition: border-color 0.12s;
  }
  .chip:hover:not(:disabled) {
    border-color: var(--border-strong);
  }
  .chip:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .toggle-group {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

</style>
