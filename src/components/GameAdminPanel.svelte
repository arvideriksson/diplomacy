<script lang="ts">
  import { fade, scale } from 'svelte/transition'
  import { updateGame, updateGameSettings, setDeadline, DEFAULT_SETTINGS } from '../lib/game'
  import type { GameState, PhaseTimers } from '../lib/game'
  import { errorMessage } from '../lib/errors'
  import PhaseTimerSettings from './PhaseTimerSettings.svelte'

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

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="overlay" transition:fade={{ duration: 150 }} on:click={onClose}>
  <div class="modal" transition:scale={{ duration: 150, start: 0.96 }} on:click|stopPropagation>
    <div class="modal-head">
      <h2>Manage game</h2>
      <button class="close" on:click={onClose} aria-label="Close">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

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
        <label class="toggle">
          <input type="checkbox" checked={earlyResolution} on:change={toggleEarly} disabled={saving} />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>

      <div class="group toggle-group">
        <div>
          <span class="label">Allow spectators</span>
          <p class="desc">Non-players can watch the game</p>
        </div>
        <label class="toggle">
          <input type="checkbox" checked={spectators} on:change={toggleSpectators} disabled={saving} />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 48px 16px;
    overflow-y: auto;
  }

  .modal {
    width: 100%;
    max-width: 460px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg, 0 20px 50px rgba(0, 0, 0, 0.3));
    padding: 22px 24px 26px;
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .modal-head h2 {
    font-size: 17px;
    font-weight: 700;
    margin: 0;
    color: var(--text);
  }

  .close {
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    padding: 4px;
    display: flex;
    border-radius: var(--radius-sm);
  }
  .close:hover {
    color: var(--text);
    background: var(--bg-hover);
  }

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

  .toggle {
    flex-shrink: 0;
    cursor: pointer;
  }
  .toggle input {
    display: none;
  }
  .toggle-track {
    display: block;
    width: 40px;
    height: 22px;
    background: var(--border-strong);
    border-radius: var(--radius-full);
    position: relative;
    transition: background 0.2s;
  }
  .toggle input:checked + .toggle-track {
    background: var(--accent);
  }
  .toggle input:disabled + .toggle-track {
    opacity: 0.5;
  }
  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    background: white;
    border-radius: 50%;
    transition: transform 0.2s;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  }
  .toggle input:checked + .toggle-track .toggle-thumb {
    transform: translateX(18px);
  }
</style>
