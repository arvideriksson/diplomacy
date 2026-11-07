<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { user } from '../lib/auth'
  import {
    fetchGame, fetchGames, updateGame, startGame, joinGame, leaveGame, kickPlayer,
    claimNation, deleteLobbyGame, DEFAULT_SETTINGS,
  } from '../lib/game'
  import { subscribeToGame } from '../lib/gameLive'
  import type { GameState, GameSettings, PhaseTimers, PlayerInfo } from '../lib/game'
  import { getMap } from '../lib/maps'
  import { actionRunner } from '../lib/action'
  import LobbySettings from './LobbySettings.svelte'
  import LobbySeats from './LobbySeats.svelte'
  import Icon from './Icon.svelte'
  import ConfirmDialog from './ConfirmDialog.svelte'
  import StatusPage from './StatusPage.svelte'
  import { errorMessage } from '../lib/errors'
  import { shortenUuid } from '../lib/shortId'
  import { dismissable } from '../lib/actions/dismissable'

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

  // A failed first read (no initialGame) replaces the lobby with the error.
  let loadError = ''
  onMount(async () => {
    try {
      if (!game) {
        game = await fetchGame(gameId)
      }
      channel = subscribeToGame(gameId, () => game, (updated) => {
        // When the host starts the game, non-host players learn via this push. Bubble it
        // up through onStart (same path the host uses) so GameRoute swaps the lobby for
        // the board — otherwise they'd sit in the lobby until a manual reload.
        const justStarted = game?.phase === 'lobby' && updated.phase !== 'lobby'
        game = updated
        if (justStarted) onStart(updated)
      })
    } catch (e) {
      loadError = errorMessage(e)
    } finally {
      loading = false
    }
  })

  onDestroy(() => {
    channel?.stop()
  })

  async function saveSettings() {
    if (!game || !isAdmin) return
    saving = true
    try {
      const settings: GameSettings = {
        ...game.settings,
        gunboat: settingsGunboat,
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
    confirming = null // a failure shows under the title
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

  // ── Invite, the ⋯ menu, delete and leave ─────────────────────────────────────
  $: inviteLink = `${window.location.origin}/join/${shortenUuid(gameId)}`
  // Phones get the share sheet; everything else copies the link.
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator && matchMedia('(pointer: coarse)').matches
  let copied = false
  async function invite() {
    if (canShare) {
      try {
        await navigator.share({ title: game?.name ?? 'Diplomacy', url: inviteLink })
      } catch {
        /* dismissed */
      }
      return
    }
    try {
      await navigator.clipboard.writeText(inviteLink)
      copied = true
      setTimeout(() => (copied = false), 2000)
    } catch {
      error = `Copy this link: ${inviteLink}`
    }
  }

  let menuOpen = false
  let confirming: 'delete' | 'leave' | null = null
  let removing = false
  $: others = game ? Object.keys(game.players).filter((uid) => uid !== $user?.id).length : 0
  $: deleteNote =
    others === 0
      ? 'The lobby closes. This can’t be undone.'
      : `The lobby closes and ${others === 1 ? 'the other player loses their seat' : `the ${others} other players lose their seats`}. This can’t be undone.`

  function ask(what: 'delete' | 'leave') {
    menuOpen = false
    confirming = what
  }

  async function handleDelete() {
    if (!game || !isAdmin) return
    removing = true
    const deleted = await run(async () => (await deleteLobbyGame(gameId), true))
    removing = false
    confirming = null
    if (deleted) {
      fetchGames().catch(() => {})
      onBack()
    }
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
{:else if loadError}
  <StatusPage message={loadError} actionLabel="Back to games" onAction={onBack} />
{:else if game}
  <div class="lobby">
    <header class="lobby-head">
      <div class="ttl">
        {#if isAdmin}
          <input
            class="title-input"
            bind:value={settingsName}
            on:blur={saveSettings}
            on:keydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            placeholder="Game name"
            aria-label="Game name"
          />
        {:else}
          <h1>{game.name}</h1>
        {/if}
        <span class="sub">Lobby · {map.name}{#if game.is_private}<span class="lock" title="Private"><Icon name="lock" size={11} /></span>{/if}</span>
      </div>
      <div class="head-actions">
        <button class="btn btn-line" type="button" on:click={invite}>
          {#if copied}<Icon name="check" size={15} />Copied{:else}<Icon name="copy" size={15} /><span class="lbl">{canShare ? 'Invite' : 'Copy invite link'}</span>{/if}
        </button>
        {#if isAdmin || isMember}
          <div class="menu-wrap" use:dismissable={{ onDismiss: () => (menuOpen = false), enabled: menuOpen }}>
            <button class="btn btn-line more" type="button" aria-label="More" aria-expanded={menuOpen} on:click={() => (menuOpen = !menuOpen)}>
              <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="3" cy="8" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="13" cy="8" r="1.5" /></svg>
            </button>
            {#if menuOpen}
              <div class="menu" role="menu">
                {#if isAdmin}
                  <button role="menuitem" class="danger" on:click={() => ask('delete')}>Delete game</button>
                {:else}
                  <button role="menuitem" class="danger" on:click={() => ask('leave')}>Leave game</button>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </header>

    {#if error}<p class="form-error">{error}</p>{/if}

    <div class="cols">
      <section class="seats-col">
        <h2>Seats</h2>
        <div class="list">
          <LobbySeats
            players={game.players}
            {powers}
            randomNations={settingsRandomNations}
            hostId={game.created_by}
            userId={$user?.id}
            isAdmin={!!isAdmin}
            isMember={!!isMember && game.phase === 'lobby'}
            onClaim={claimPower}
            onKick={handleKick}
          />
          <div class="lfoot">
            <span class="count">{playerCount} of {maxPlayers} {maxPlayers === 1 ? 'seat' : 'seats'} taken</span>
            <span class="action">
              {#if canJoin}
                <button class="btn btn-primary" type="button" disabled={joiningGame} on:click={handleJoin}>{joiningGame ? 'Joining…' : 'Join game'}</button>
              {:else if isAdmin}
                <button class="btn btn-primary" type="button" disabled={!canStart || starting} title={playerCount < 2 ? 'A game needs at least two players' : undefined} on:click={handleStartGame}>{starting ? 'Starting…' : 'Start game'}</button>
              {:else if isMember}
                <span class="note">The host starts the game</span>
              {:else if playerCount >= maxPlayers}
                <span class="note">Game is full</span>
              {/if}
            </span>
          </div>
        </div>
        {#if claimError}<p class="form-error">{claimError}</p>{/if}
      </section>

      <div class="settings-col">
        <LobbySettings
          isAdmin={!!isAdmin}
          canChooseMap={!!canChooseMap}
          timers={settingsPhaseTimers}
          grace={settingsGracePeriod}
          firstTurn={settingsFirstTurn}
          earlyResolution={settingsEarlyResolution}
          mapId={settingsMapId}
          gunboat={settingsGunboat}
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
          onRandomNationsChange={setAndSave((v) => (settingsRandomNations = v))}
          onTogglePrivate={togglePrivate}
          onHostControlsChange={setAndSave((v) => (settingsHostControls = v))}
        />
      </div>
    </div>

    <!-- Phones: the main action pinned to the bottom of the screen. -->
    {#if canJoin || isAdmin}
      <div class="sticky-action">
        <span class="count">{playerCount} of {maxPlayers}</span>
        {#if canJoin}
          <button class="btn btn-primary" type="button" disabled={joiningGame} on:click={handleJoin}>{joiningGame ? 'Joining…' : 'Join game'}</button>
        {:else}
          <button class="btn btn-primary" type="button" disabled={!canStart || starting} on:click={handleStartGame}>{starting ? 'Starting…' : 'Start game'}</button>
        {/if}
      </div>
    {/if}
  </div>
{/if}

{#if game && confirming === 'delete'}
  <ConfirmDialog
    title="Delete {game.name}?"
    message={deleteNote}
    confirmLabel={removing ? 'Deleting…' : 'Delete game'}
    tone="danger"
    busy={removing}
    onConfirm={handleDelete}
    onCancel={() => (confirming = null)}
  />
{:else if game && confirming === 'leave'}
  <ConfirmDialog
    title="Leave {game.name}?"
    message="Your seat opens for someone else. You can rejoin while it’s open."
    confirmLabel="Leave game"
    tone="danger"
    onConfirm={handleLeave}
    onCancel={() => (confirming = null)}
  />
{/if}

<style>
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 80px 0;
  }
  .lobby {
    display: flex;
    flex-direction: column;
    gap: 22px;
  }

  /* Title, then the invite and ⋯ actions. */
  .lobby-head {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .ttl {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  h1,
  .title-input {
    margin: 0;
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.3px;
    line-height: 1.2;
    color: var(--text);
  }
  .title-input {
    width: 100%;
    min-width: 0;
    padding: 0 0 2px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    outline: none;
  }
  .title-input:hover {
    border-bottom-color: var(--border);
  }
  .title-input:focus {
    border-bottom-color: var(--accent);
  }
  .sub {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    color: var(--text-tertiary);
  }
  .lock {
    display: flex;
  }
  .head-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }
  .btn-line {
    gap: 6px;
    height: 36px;
    padding: 0 14px;
    background: var(--bg-card);
    border: 1px solid var(--border-strong);
    color: var(--text);
    font-size: 13px;
  }
  .more {
    width: 36px;
    padding: 0;
  }
  .menu-wrap {
    position: relative;
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 20;
    min-width: 180px;
    padding: 4px 0;
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-lg);
  }
  .menu button {
    display: block;
    width: 100%;
    padding: 9px 14px;
    border: none;
    background: none;
    font: 500 14px var(--font);
    text-align: left;
    color: var(--text);
    cursor: pointer;
  }
  .menu button:hover {
    background: var(--bg-hover);
  }
  .menu .danger {
    color: var(--red);
  }

  /* Seats beside settings. */
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 24px;
    align-items: start;
  }
  .seats-col,
  .settings-col {
    display: flex;
    flex-direction: column;
    gap: 24px;
    min-width: 0;
  }
  .seats-col {
    gap: 0;
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
  .lfoot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 54px;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
  }
  .count,
  .note {
    font-size: 12.5px;
    color: var(--text-tertiary);
  }
  .form-error {
    margin: 8px 2px 0;
    font-size: 13px;
    color: var(--red);
  }
  .sticky-action {
    display: none;
  }

  @media (max-width: 760px) {
    .cols {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 600px) {
    .lobby {
      padding-bottom: 84px;
    }
    /* The title gets the full width; the actions drop below it. */
    .lobby-head {
      flex-wrap: wrap;
    }
    .ttl {
      flex-basis: 100%;
    }
    h1,
    .title-input {
      font-size: 22px;
    }
    /* Rows run edge to edge (App's main has 16px gutters). */
    .list {
      margin: 0 -16px;
      border-left: none;
      border-right: none;
    }
    .lfoot .action {
      display: none;
    }
    .sticky-action {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 30;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
      background: var(--bg-card);
      border-top: 1px solid var(--border);
    }
    .sticky-action .btn {
      flex: 1;
      height: 44px;
      font-size: 15px;
    }
  }
</style>
