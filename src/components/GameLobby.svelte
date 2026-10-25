<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { user } from '../lib/auth'
  import {
    fetchGame, updateGame, startGame, subscribeToGame, joinGame, leaveGame, kickPlayer,
    claimNation, DEFAULT_SETTINGS,
  } from '../lib/game'
  import type { GameState, GameSettings, PhaseTimers, PlayerInfo } from '../lib/game'
  import { getMap } from '../lib/maps'
  import { initialBoard } from '../lib/adjudicator'
  import { actionRunner } from '../lib/action'
  import LobbySettings from './LobbySettings.svelte'
  import PowerPicker from './PowerPicker.svelte'
  import InviteCard from './InviteCard.svelte'
  import PlayerList from './PlayerList.svelte'
  import LobbyActions from './LobbyActions.svelte'

  export let gameId: string
  export let initialGame: GameState | null = null
  export let onBack: () => void = () => {}
  export let onStart: (game: GameState) => void = () => {}

  let game: GameState | null = initialGame
  let loading = !initialGame
  let saving = false
  let starting = false
  let channel: ReturnType<typeof subscribeToGame> | null = null

  let joiningGame = false

  $: isAdmin = game && $user && game.created_by === $user.id
  $: playerCount = game ? Object.keys(game.players).length : 0
  $: isMember = game && $user && !!game.players[$user.id]
  $: canJoin = game && $user && !isMember && playerCount < maxPlayers && game.phase === 'lobby'
  $: canStart = isAdmin && playerCount >= 2 && game?.phase === 'lobby'

  $: settingsName = game?.name ?? ''
  $: settingsPhaseTimers = game?.settings?.phase_timers ?? DEFAULT_SETTINGS.phase_timers
  $: settingsGracePeriod = game?.settings?.grace_period ?? null
  $: settingsFirstTurn = game?.settings?.first_turn ?? null
  $: settingsEarlyResolution = game?.settings?.early_resolution ?? DEFAULT_SETTINGS.early_resolution
  $: settingsMapId = game?.map_id ?? 'classical'
  $: settingsGunboat = game?.settings?.gunboat ?? DEFAULT_SETTINGS.gunboat
  $: settingsSpectators = game?.settings?.allow_spectators ?? DEFAULT_SETTINGS.allow_spectators
  $: settingsRandomNations = game?.settings?.random_nations ?? DEFAULT_SETTINGS.random_nations
  $: settingsHostControls = !!game?.settings?.host_controls
  // Host-controlled games must stay private (server-enforced).
  $: hostControls = !!game?.settings?.host_controls

  // The map can only be chosen before the game starts; it's fixed once units are on the board.
  $: canChooseMap = isAdmin && game?.phase === 'lobby'

  // ── Power picker (shown when nations aren't random) ──────────────────────────
  $: map = getMap(game?.map_id ?? 'classical')
  $: powers = map.powers
  // One seat per power.
  $: maxPlayers = powers.length
  $: myNation = game && $user ? game.players[$user.id]?.nation : undefined
  // power id -> the player holding it
  $: holderByNation = game
    ? Object.entries(game.players).reduce(
        (acc, [uid, p]) => {
          if (p.nation) acc[p.nation] = { uid, info: p }
          return acc
        },
        {} as Record<string, { uid: string; info: PlayerInfo }>,
      )
    : {}
  // Centers each power starts with (home centers plus any variant extras, e.g. 1900 Egypt).
  $: startCenters = Object.values(initialBoard(map).supplyCenters)
  $: homeCenters = (id: string): number => startCenters.filter((n) => n === id).length

  // Failed actions report inline instead of becoming unhandled rejections. Power
  // claims report next to the picker; everything else under the title.
  let error = ''
  let claimError = ''
  const run = actionRunner((m) => (error = m))
  const runClaim = actionRunner((m) => (claimError = m))

  async function claimPower(nation: string) {
    if (!game || !isMember || game.phase !== 'lobby') return
    // clicking your own power releases it
    await runClaim(() => claimNation(gameId, myNation === nation ? null : nation))
  }

  onMount(async () => {
    try {
      if (!game) {
        game = await fetchGame(gameId)
      }
      channel = subscribeToGame(gameId, (updated) => {
        // When the host starts the game, non-host players learn via this push. Bubble it
        // up through onStart (same path the host uses) so GameRoute swaps the lobby for
        // the board — otherwise they'd sit in the lobby until a manual reload.
        const justStarted = game?.phase === 'lobby' && updated.phase !== 'lobby'
        game = updated
        if (justStarted) onStart(updated)
      })
    } finally {
      loading = false
    }
  })

  onDestroy(() => {
    if (channel) {
      channel.unsubscribe()
    }
  })

  async function saveSettings() {
    if (!game || !isAdmin) return
    saving = true
    try {
      const settings: GameSettings = {
        ...game.settings,
        gunboat: settingsGunboat,
        allow_spectators: settingsSpectators,
        random_nations: settingsRandomNations,
        host_controls: settingsHostControls && game.is_private,
        early_resolution: settingsEarlyResolution,
        phase_timers: settingsPhaseTimers,
        // null, not undefined: the server merges settings, so an omitted key wouldn't clear.
        grace_period: settingsGracePeriod,
        first_turn: settingsFirstTurn,
      }
      // The map is a top-level column, not a setting; only mutable in the lobby.
      const updates: Parameters<typeof updateGame>[1] = { name: settingsName, settings }
      if (game.phase === 'lobby') updates.map_id = settingsMapId
      game = (await run(() => updateGame(gameId, updates))) ?? game
    } finally {
      saving = false
    }
  }

  async function togglePrivate() {
    if (!game || !isAdmin) return
    const isPrivate = !game.is_private
    game = (await run(() => updateGame(gameId, { is_private: isPrivate }))) ?? game
  }

  async function handleStartGame() {
    if (!game || !isAdmin) return
    starting = true
    try {
      const started = await run(() => startGame(game!))
      if (started) {
        game = started
        onStart(started)
      }
    } finally {
      starting = false
    }
  }

  async function handleJoin() {
    if (!game || !$user || !canJoin) return
    joiningGame = true
    try {
      game = (await run(() => joinGame(gameId))) ?? game
    } finally {
      joiningGame = false
    }
  }

  async function handleLeave() {
    if (!game || !$user) return
    const left = await run(async () => (await leaveGame(gameId), true))
    if (left) onBack() // leaving returns to the game list
  }

  async function handleKick(playerId: string) {
    if (!game || !isAdmin) return
    const kicked = await run(async () => (await kickPlayer(gameId, playerId), true))
    if (!kicked || !game) return
    const { [playerId]: _, ...remaining } = game.players
    game = { ...game, players: remaining }
  }

  function onTimersChange(t: PhaseTimers) {
    settingsPhaseTimers = t
    saveSettings()
  }

  function onGraceChange(v: number | null) {
    settingsGracePeriod = v
    saveSettings()
  }

  function onFirstTurnChange(v: number | null) {
    settingsFirstTurn = v
    saveSettings()
  }

  // A toggle setting: apply the new value locally, then persist.
  const setAndSave = (apply: (v: boolean) => void) => (v: boolean) => {
    apply(v)
    saveSettings()
  }
</script>

{#if loading}
  <div class="loading">
    <div class="spinner"></div>
  </div>
{:else if game}
  <div class="lobby">
    <div class="lobby-top">
      <div class="lobby-title-row">
        {#if isAdmin}
          <input
            class="title-input"
            bind:value={settingsName}
            on:blur={saveSettings}
            on:keydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            placeholder="Game name"
          />
        {:else}
          <h1>{game.name}</h1>
        {/if}
        <span class="badge badge-caps phase-badge">{game.phase}</span>
      </div>
      {#if error}<p class="form-error">{error}</p>{/if}
    </div>

    <div class="lobby-grid">
      <div class="lobby-main">
        <LobbySettings
          isAdmin={!!isAdmin}
          canChooseMap={!!canChooseMap}
          timers={settingsPhaseTimers}
          grace={settingsGracePeriod}
          firstTurn={settingsFirstTurn}
          earlyResolution={settingsEarlyResolution}
          mapId={settingsMapId}
          gunboat={settingsGunboat}
          spectators={settingsSpectators}
          randomNations={settingsRandomNations}
          isPrivate={game.is_private}
          hostControls={settingsHostControls}
          hostControlsLocked={hostControls}
          {onTimersChange}
          {onGraceChange}
          {onFirstTurnChange}
          onEarlyChange={setAndSave((v) => (settingsEarlyResolution = v))}
          onMapChange={(id) => { settingsMapId = id; saveSettings() }}
          onGunboatChange={setAndSave((v) => (settingsGunboat = v))}
          onSpectatorsChange={setAndSave((v) => (settingsSpectators = v))}
          onRandomNationsChange={setAndSave((v) => (settingsRandomNations = v))}
          onTogglePrivate={togglePrivate}
          onHostControlsChange={setAndSave((v) => (settingsHostControls = v))}
        />

        {#if game.phase === 'lobby' && !settingsRandomNations && isMember}
          <PowerPicker {powers} {holderByNation} {myNation} error={claimError} onClaim={claimPower} />
        {/if}
      </div>

      <div class="lobby-sidebar">
        {#if game.phase === 'lobby'}
          <InviteCard {gameId} />
        {/if}

        <PlayerList
          players={game.players}
          {powers}
          {maxPlayers}
          hostId={game.created_by}
          userId={$user?.id}
          isAdmin={!!isAdmin}
          onLeave={handleLeave}
          onKick={handleKick}
        />

        <LobbyActions
          canJoin={!!canJoin}
          joining={joiningGame}
          full={playerCount >= maxPlayers}
          isAdmin={!!isAdmin}
          isMember={!!isMember}
          canStart={!!canStart}
          {starting}
          needsPlayers={playerCount < 2}
          onJoin={handleJoin}
          onStart={handleStartGame}
        />
      </div>
    </div>
  </div>
{/if}

<style>
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 80px 0;
  }

  .lobby-top {
    margin-bottom: 28px;
  }

  .lobby-title-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .title-input {
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.5px;
    color: var(--text);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 0 0 2px;
    outline: none;
    font-family: var(--font);
    transition: border-color 0.15s;
    flex: 1;
    min-width: 0;
  }

  .title-input:hover {
    border-bottom-color: var(--border);
  }

  .title-input:focus {
    border-bottom-color: var(--accent);
  }

  h1 {
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.5px;
    margin: 0;
    color: var(--text);
  }

  .phase-badge {
    font-size: 12px;
    padding: 3px 10px;
  }

  .lobby-top .form-error {
    margin-top: 12px;
  }

  .lobby-grid {
    display: grid;
    /* minmax(0, …) so a long unbreakable child (the invite URL) can't widen the column. */
    grid-template-columns: minmax(0, 1fr) 340px;
    gap: 20px;
    align-items: start;
  }

  /* One column: flatten both columns into a single stack and reorder it so what a
     player acts on comes first — power, invite, players — then the settings, with
     Join / Start pinned to the bottom of the screen. */
  @media (max-width: 768px) {
    .lobby-grid {
      display: flex;
      flex-direction: column;
      gap: 12px;
      align-items: stretch;
    }

    .lobby-main,
    .lobby-sidebar {
      display: contents;
    }

    .lobby-grid :global(.card),
    .lobby-grid :global(.lobby-actions) {
      margin: 0;
    }

    .lobby-grid :global(.power-picker) { order: 1; }
    .lobby-grid :global(.invite-card) { order: 2; }
    .lobby-grid :global(.players-card) { order: 3; }
    .lobby-grid :global(.lobby-settings) { order: 4; }
    .lobby-grid :global(.lobby-actions) {
      order: 5;
      position: sticky;
      bottom: 0;
      z-index: 5;
      margin: 0 -16px;
      padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
      background: linear-gradient(to bottom, transparent, var(--bg) 14px);
    }
    /* Nothing to show (a non-member watching a full lobby): drop the sticky bar. */
    .lobby-grid :global(.lobby-actions:empty) {
      display: none;
    }
  }

  @media (max-width: 600px) {
    .lobby-top {
      margin-bottom: 16px;
    }

    .title-input,
    h1 {
      font-size: 22px;
    }

    h1 {
      overflow-wrap: anywhere;
    }
  }
</style>
