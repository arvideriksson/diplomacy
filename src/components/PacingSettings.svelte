<script lang="ts" context="module">
  // Explanations shared by the lobby settings and the in-game host panel. Mid-game
  // edits behave slightly differently, so those get an extra sentence.
  export const PACING_TIPS = {
    timers: 'How long each phase runs before its deadline.',
    timersMidGame: 'Applies to phases opened from the next resolution onward.',
    grace:
      "If anyone hasn't submitted by the deadline, the phase waits this long for them. It resolves the moment the last orders arrive, or when the grace period ends (missing units hold).",
    graceMidGame: 'Applies to the current phase too.',
    early: 'Resolve as soon as every power has submitted, instead of waiting for the deadline.',
  } as const
</script>

<script lang="ts">
  // Pacing settings: per-phase timers, the deadline grace period and early resolution.
  import type { PhaseTimers } from '../lib/game'
  import InfoTip from './InfoTip.svelte'
  import PhaseTimerSettings from './PhaseTimerSettings.svelte'
  import GracePeriodSetting from './GracePeriodSetting.svelte'
  import ToggleSetting from './ToggleSetting.svelte'

  export let timers: PhaseTimers
  /** Grace period in minutes; null = one movement timer. */
  export let grace: number | null
  export let earlyResolution: boolean
  export let disabled = false
  /** Editing a running game (host panel) rather than the lobby. */
  export let midGame = false
  export let onTimersChange: (t: PhaseTimers) => void
  export let onGraceChange: (v: number | null) => void
  export let onEarlyChange: (v: boolean) => void

  $: timersTip = midGame ? PACING_TIPS.timersMidGame : PACING_TIPS.timers
  $: graceTip = midGame ? `${PACING_TIPS.grace} ${PACING_TIPS.graceMidGame}` : PACING_TIPS.grace
</script>

<div class="setting-group">
  <span class="setting-label">Phase timers<InfoTip text={timersTip} /></span>
  <PhaseTimerSettings {timers} {disabled} onChange={onTimersChange} />
</div>

<div class="setting-group">
  <span class="setting-label">Grace period<InfoTip text={graceTip} /></span>
  <GracePeriodSetting value={grace} movement={timers.movement} {disabled} onChange={onGraceChange} />
</div>

<ToggleSetting
  label="Early resolution"
  tip={PACING_TIPS.early}
  checked={earlyResolution}
  {disabled}
  onChange={onEarlyChange}
/>
