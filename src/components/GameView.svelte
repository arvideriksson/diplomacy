<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import GameBoard from './GameBoard.svelte'
  import ChatPanel from './ChatPanel.svelte'
  import GameAdminPanel from './GameAdminPanel.svelte'
  import { user } from '../lib/auth'
  import { fetchGame, fetchResolvedLog, subscribeToGame, graceMinutes } from '../lib/game'
  import type { GameState } from '../lib/game'
  import { replayFrames, type HistoryFrame } from '../lib/history'
  import { getMap } from '../lib/maps'
  import { initialBoard, victoryFor } from '../lib/adjudicator'
  import type { BoardState } from '../lib/adjudicator'

  export let game: GameState
  export let nation: string = ''
  /** Leave the game and return to the menu (header is hidden in-game). */
  export let onExit: (() => void) | null = null

  $: map = getMap(game.map_id)

  // The creator manages a running game from an in-board panel.
  let showAdmin = false
  $: isCreator = !!($user && game.created_by === $user.id)
  $: isActive = ['movement', 'retreat', 'build'].includes(game.phase)
  // A finished game (the adjudicator sets phase 'complete' on a win) is view-only.
  $: isComplete = game.phase === 'complete'
  $: winner = isComplete ? victoryFor(map, liveBoard().supplyCenters) : undefined
  $: winnerName = winner ? (map.powers.find((p) => p.id === winner!.nation)?.name ?? winner.nation) : ''
  // Only games created with host controls get the in-game admin menu. A finished game
  // keeps it so the host can still revert out of the ending.
  $: canManage = isCreator && (isActive || isComplete) && !!game.settings?.host_controls
  // Played powers that haven't submitted this round — who a grace period waits on.
  $: awaiting = [...new Set(Object.values(game.players).map((p) => p.nation).filter((n): n is string => !!n))]
    .filter((n) => !game.ready?.[n])
    .map((n) => map.powers.find((p) => p.id === n)?.name ?? n)

  let frames: HistoryFrame[] = []
  let cursor = 0
  let loaded = false

  // Authoritative current board: the snapshot if present. A null snapshot only occurs
  // before the first resolution, which is exactly the map's opening position.
  function liveBoard(): BoardState {
    if (game.snapshot) return game.snapshot as BoardState
    return initialBoard(map)
  }

  async function load() {
    let past: HistoryFrame[] = []
    try {
      // replayFrames' last frame is the reconstructed current board — drop it and
      // use the authoritative live board for the frontier instead.
      past = replayFrames(map, await fetchResolvedLog(game.id), { year: game.year, season: game.season, phase: game.phase }).slice(0, -1)
    } catch {
      past = []
    }
    frames = [...past, { board: liveBoard(), orders: [] }]
    cursor = frames.length - 1 // default to the live phase
    loaded = true
  }
  onMount(load)

  // Live updates: when the adjudicator resolves a round it writes the games row, which
  // Realtime pushes here. Reassigning `game` cascades to the round-change reload below
  // (new board) and recomputes the `ready` prop — so the board advances without a reload.
  //
  // The subscription is scoped to tab VISIBILITY: a hidden tab gets its WebSocket frozen
  // by the browser anyway, so holding it open is pure waste — it just burns a concurrent
  // connection and receives full-row broadcasts no one is looking at. So we drop the
  // socket when hidden and re-open it on focus, after a refetch to catch up on whatever
  // resolved while we were away. Net effect: ~one connection per window (not per tab),
  // and broadcasts only reach tabs actually being viewed.
  let channel: ReturnType<typeof subscribeToGame> | null = null
  function subscribe() {
    if (!channel) channel = subscribeToGame(game.id, (updated) => (game = updated))
  }
  function unsubscribe() {
    channel?.unsubscribe()
    channel = null
  }
  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      subscribe() // go live first, then refetch — so an update landing mid-catch-up isn't lost
      fetchGame(game.id)
        .then((g) => (game = g))
        .catch(() => {})
    } else {
      unsubscribe()
    }
  }
  onMount(() => {
    if (document.visibilityState === 'visible') subscribe()
    document.addEventListener('visibilitychange', onVisibilityChange)
  })
  onDestroy(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    unsubscribe()
  })

  // Reload history when the game advances to a new round (new resolved phase).
  let lastRound = ''
  $: {
    const r = `${game.year}|${game.season}|${game.phase}`
    if (r !== lastRound) {
      lastRound = r
      if (loaded) load()
    }
  }

  $: frame = frames[cursor]
  $: isFrontier = cursor === frames.length - 1
  $: canBack = cursor > 0
  $: canForward = cursor < frames.length - 1
</script>

{#if frame}
  <GameBoard
    mapDef={map}
    {onExit}
    leftWidth={nation && game.phase !== 'lobby' ? '560px' : '320px'}
    title={game.name}
    gameId={game.id}
    units={frame.board.units}
    ownership={frame.board.supplyCenters}
    nation={isFrontier && !isComplete ? nation : ''}
    phase={frame.board.phase}
    season={frame.board.season}
    year={frame.board.year}
    ready={isFrontier && !!(nation && game.ready?.[nation])}
    dislodged={frame.board.dislodged}
    contested={frame.board.contested}
    supplyCenters={frame.board.supplyCenters}
    readOnly={!isFrontier || isComplete}
    deadline={isFrontier && !isComplete ? game.deadline ?? null : null}
    {awaiting}
    graceMinutes={graceMinutes(game.settings)}
    historyOrders={frame.orders}
    onPhaseBack={() => canBack && (cursor -= 1)}
    onPhaseForward={() => canForward && (cursor += 1)}
    canPhaseBack={canBack}
    canPhaseForward={canForward}
    seedKey={String(cursor)}
  >
    <svelte:fragment slot="map-action">
      {#if canManage}
        <button class="cog-btn" on:click={() => (showAdmin = true)} title="Manage game" aria-label="Manage game">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      {/if}
    </svelte:fragment>

    <svelte:fragment slot="results">
      {#if isComplete}
        <div class="game-over">
          {#if winner}🏆 {winnerName} wins with {winner.centers} supply centers.{:else}This game is over.{/if}
        </div>
      {/if}
    </svelte:fragment>
    <svelte:fragment slot="left">
      {#if nation && game.phase !== 'lobby' && !game.settings?.gunboat}
        <ChatPanel gameId={game.id} {nation} players={game.players} powers={map.powers} />
      {/if}
    </svelte:fragment>
  </GameBoard>
{/if}

{#if showAdmin}
  <GameAdminPanel
    {game}
    pastRounds={frames.slice(0, -1).map((f) => ({ year: f.board.year, season: f.board.season, phase: f.board.phase }))}
    onClose={() => (showAdmin = false)}
    onGameUpdate={(g) => (game = g)}
  />
{/if}

<style>
  .game-over {
    margin: 0 14px 14px;
    padding: 12px 14px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--amber, #f59e0b) 16%, var(--bg-card, #fff));
    border: 1px solid color-mix(in srgb, var(--amber, #f59e0b) 45%, transparent);
    font-weight: 600;
  }
  /* Frosted floating button, mirrored to the supply-center card. */
  .cog-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    padding: 0;
    color: var(--text-secondary);
    background: color-mix(in srgb, var(--bg-card, #fff) 88%, transparent);
    backdrop-filter: blur(12px) saturate(1.4);
    -webkit-backdrop-filter: blur(12px) saturate(1.4);
    border: 1px solid var(--border, rgba(0, 0, 0, 0.12));
    border-radius: 12px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.22);
    cursor: pointer;
    transition: color 0.12s, border-color 0.12s;
  }
  .cog-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
  .cog-btn svg {
    transition: transform 0.3s ease;
  }
  .cog-btn:hover svg {
    transform: rotate(45deg);
  }
</style>

