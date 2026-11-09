<script lang="ts" context="module">
  // The lobby's explanations for each pacing setting.
  export const PACING_TIPS = {
    timers: 'How long each phase runs before its deadline. The first turn can run longer for opening negotiations.',
    grace:
      "If anyone hasn't submitted by the deadline, the phase waits this long for them. It resolves the moment the last orders arrive, or when the grace period ends (missing units hold).",
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
  export let onTimersChange: (t: PhaseTimers) => void
  /** First-phase length (minutes); null = the movement timer. */
  export let firstTurn: number | null = null
  export let onFirstTurnChange: ((v: number | null) => void) | null = null
  export let onGraceChange: (v: number | null) => void
  export let onEarlyChange: (v: boolean) => void
</script>

<div class="setting-group">
  <span class="setting-label">Phase timers<InfoTip text={PACING_TIPS.timers} /></span>
  <PhaseTimerSettings
    {timers}
    {disabled}
    onChange={onTimersChange}
    {firstTurn}
    {onFirstTurnChange}
  />
</div>

<div class="setting-group">
  <span class="setting-label">Grace period<InfoTip text={PACING_TIPS.grace} /></span>
  <GracePeriodSetting value={grace} movement={timers.movement} {disabled} onChange={onGraceChange} />
</div>

<ToggleSetting
  label="Early resolution"
  tip={PACING_TIPS.early}
  checked={earlyResolution}
  {disabled}
  onChange={onEarlyChange}
/>
