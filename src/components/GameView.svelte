<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import GameBoard from './GameBoard.svelte'
  import SandboxBoard from './SandboxBoard.svelte'
  import ChatPanel from './ChatPanel.svelte'
  import GameAdminPanel from './GameAdminPanel.svelte'
  import VictoryBanner from './VictoryBanner.svelte'
  import DrawVote from './DrawVote.svelte'
  import { survivingNations } from '../lib/draw'
  import Icon from './Icon.svelte'
  import { user } from '../lib/auth'
  import { fetchGame, fetchResolvedLog, subscribeToGame } from '../lib/game'
  import type { GameState } from '../lib/game'
  import { replayFrames, type HistoryFrame } from '../lib/history'
  import { getMap } from '../lib/maps'
  import { initialBoard, victoryFor } from '../lib/adjudicator'
  import type { BoardState } from '../lib/adjudicator'
  import { isOrderPhase, PHASE_LABEL } from '../lib/phases'
  import { powerName } from '../lib/powers'
  import { sandboxes, sandboxesOf, createSandboxFromGame, deleteSandbox } from '../lib/sandbox'
  import type { AnyOrder } from '../lib/orders/types'
  import { compact, type GameTab } from '../lib/layout'

  export let game: GameState
  export let nation: string = ''
  /** Leave the game and return to the menu (header is hidden in-game). */
  export let onExit: (() => void) | null = null

  $: map = getMap(game.map_id)

  // The creator manages a running game from an in-board panel.
  let showAdmin = false
  $: isCreator = !!($user && game.created_by === $user.id)
  $: isActive = isOrderPhase(game.phase)
  // A finished game (the adjudicator sets phase 'complete' on a win) is view-only.
  $: isComplete = game.phase === 'complete'
  // A solo by supply centers is read off the board; a tie or a win by concession is
  // stamped on the game (game.result) when the players' votes agree.
  $: winner = isComplete && !game.result ? victoryFor(map, liveBoard().supplyCenters) : undefined
  $: playedNations = [...new Set(Object.values(game.players).map((p) => p.nation).filter((n): n is string => !!n))]
  // Only games created with host controls get the in-game admin menu. A finished game
  // keeps it so the host can still revert out of the ending.
  $: canManage = isCreator && (isActive || isComplete) && !!game.settings?.host_controls
  // Played powers that haven't submitted this round — who a grace period waits on.
  $: awaiting = [...new Set(Object.values(game.players).map((p) => p.nation).filter((n): n is string => !!n))]
    .filter((n) => !game.ready?.[n])
    .map((n) => powerName(map.powers, n))

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

  // ── sandboxes copied from this game ────────────────────────────────────────
  // The open sandbox lives in the URL (?sandbox=id) so a reload or shared tab returns to
  // it; switching is a plain state change, so the game stays loaded and live meanwhile.
  let sandboxId: string | null = new URLSearchParams(location.search).get('sandbox')
  $: mySandboxes = sandboxesOf($sandboxes, game.id)
  $: sandbox = sandboxId ? mySandboxes.find((s) => s.id === sandboxId) : undefined
  let tab: GameTab = 'map'
  // The viewer's current orders on the live board — copied into a new sandbox.
  let liveOrders: AnyOrder[] = []

  // Entering pushes a history entry, so the phone's back gesture returns to the game;
  // leaving pops it when it's ours (else just rewrites the URL).
  function enterSandbox(id: string) {
    sandboxId = id
    history.pushState({ ...history.state, sandbox: id }, '', `${location.pathname}?sandbox=${id}`)
  }
  function syncFromUrl() {
    sandboxId = new URLSearchParams(location.search).get('sandbox')
  }
  onMount(() => {
    window.addEventListener('popstate', syncFromUrl)
    return () => window.removeEventListener('popstate', syncFromUrl)
  })
  function newSandbox() {
    const board = liveBoard()
    const phaseLabel = isOrderPhase(board.phase) ? PHASE_LABEL[board.phase] : board.phase
    const round = `${board.season} ${board.year} ${phaseLabel}`
    const n = mySandboxes.filter((s) => s.name.startsWith(round)).length
    const sb = createSandboxFromGame({
      name: n ? `${round} #${n + 1}` : round,
      mapId: game.map_id,
      board,
      orders: isFrontier ? liveOrders : [],
      origin: { gameId: game.id, gameName: game.name },
    })
    enterSandbox(sb.id)
  }
  // Back from a sandbox to the game lands on the map; into one, also on the map.
  function leaveSandbox() {
    if (history.state?.sandbox === sandboxId) history.back()
    else history.replaceState(history.state, '', location.pathname)
    sandboxId = null
    tab = 'map'
  }

  let unread = 0

  $: frame = frames[cursor]
  $: isFrontier = cursor === frames.length - 1
  $: canBack = cursor > 0
  $: canForward = cursor < frames.length - 1
</script>

{#if sandbox}
  {#key sandbox.id}
    <SandboxBoard {sandbox} {map} onExit={leaveSandbox} onDeleted={leaveSandbox} focusNation={nation} />
  {/key}
{:else if frame}
  <GameBoard
    bind:tab
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
    graceEndsAt={isFrontier && !isComplete ? game.grace_ends_at ?? null : null}
    historyOrders={frame.orders}
    historyResults={frame.results ?? []}
    onPhaseBack={() => canBack && (cursor -= 1)}
    onPhaseLatest={() => (cursor = frames.length - 1)}
    onOrdersChange={(o) => (liveOrders = o)}
    pressBadge={unread}
    onPhaseForward={() => canForward && (cursor += 1)}
    canPhaseBack={canBack}
    canPhaseForward={canForward}
    seedKey={String(cursor)}
  >
    <svelte:fragment slot="map-action">
      {#if mySandboxes.length}
        <button class="glass sb-chip" class:icon={$compact} on:click={() => enterSandbox(mySandboxes[0].id)} title="Open your latest sandbox" aria-label="Open your latest sandbox">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6M10 3v6l-5.5 9.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-2.5L14 9V3" /><path d="M7.5 15h9" /></svg>
          {#if !$compact}<span>Sandbox ›</span>{/if}
        </button>
      {/if}
      {#if canManage}
        <button class="glass cog-btn" on:click={() => (showAdmin = true)} title="Manage game" aria-label="Manage game">
          <Icon name="gear" size={17} />
        </button>
      {/if}
    </svelte:fragment>

    <svelte:fragment slot="results">
      {#if isComplete}
        <VictoryBanner
          winner={winner && { name: powerName(map.powers, winner.nation), centers: winner.centers }}
          result={game.result && { kind: game.result.kind, names: game.result.nations.map((n) => powerName(map.powers, n)) }}
        />
      {/if}
    </svelte:fragment>
    <svelte:fragment slot="left">
      {#if nation && game.phase !== 'lobby' && !game.settings?.gunboat}
        <ChatPanel gameId={game.id} {nation} players={game.players} powers={map.powers} onUnread={(n) => (unread = n)} />
      {/if}
    </svelte:fragment>
    <svelte:fragment slot="orders-extra">
      {#if !isComplete}
        <section class="sb-launch">
          <h4>Sandbox</h4>
          <button class="btn sb-new" on:click={newSandbox}>＋ New sandbox from {frame.board.season} {frame.board.year}</button>
          {#if mySandboxes.length}
            <ul>
              {#each mySandboxes as sb (sb.id)}
                <li>
                  <button class="sb-open" on:click={() => enterSandbox(sb.id)}>
                    <span class="sb-name">From {sb.name}</span>
                    <span class="sb-at">{sb.frames[sb.cursor].board.season} {sb.frames[sb.cursor].board.year} ›</span>
                  </button>
                  <button class="sb-del" on:click={() => deleteSandbox(sb.id)} aria-label="Delete sandbox {sb.name}" title="Delete sandbox">
                    <Icon name="trash" size={16} round />
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/if}
      {#if nation && (isActive || isComplete) && game.phase !== 'lobby'}
        {#key isComplete}
          <DrawVote
            gameId={game.id}
            {nation}
            powers={map.powers}
            nations={playedNations}
            alive={survivingNations(liveBoard(), playedNations)}
            complete={isComplete}
          />
        {/key}
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
  .sb-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 38px;
    padding: 0 12px;
    border-radius: 999px;
    color: var(--amber);
    font: 700 13px var(--font);
    cursor: pointer;
  }
  .sb-chip.icon {
    width: 38px;
    padding: 0;
    justify-content: center;
    border-color: color-mix(in srgb, var(--amber) 55%, transparent);
  }
  .sb-chip:hover {
    border-color: var(--amber);
  }
  .sb-launch {
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 12px 14px;
    background: var(--bg-card);
  }
  .sb-launch h4 {
    margin: 0 0 8px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--amber);
  }
  .sb-launch .sb-new {
    width: 100%;
    min-height: 44px;
    border: 1.5px solid var(--amber);
    background: var(--amber-subtle);
    color: var(--amber);
    font-weight: 700;
  }
  .sb-launch .sb-new:hover {
    background: color-mix(in srgb, var(--amber) 20%, transparent);
  }
  .sb-launch ul {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
  }
  .sb-launch li {
    display: flex;
    align-items: center;
  }
  .sb-launch li + li {
    border-top: 1px solid var(--border);
  }
  .sb-open {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 42px;
    padding: 0 12px;
    border: none;
    background: none;
    color: var(--text);
    font: 600 14px var(--font);
    text-align: left;
    cursor: pointer;
  }
  .sb-open:hover {
    background: var(--bg-hover);
  }
  .sb-at {
    flex: none;
    color: var(--accent);
    font-size: 13px;
  }
  .sb-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sb-del {
    flex: none;
    width: 42px;
    height: 42px;
    display: grid;
    place-items: center;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
  }
  .sb-del:hover {
    color: var(--red);
  }
  /* Frosted (.glass) floating button, mirrored to the supply-center card. */
  .cog-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    padding: 0;
    color: var(--text-secondary);
    border-radius: 12px;
    cursor: pointer;
    transition: color 0.12s, border-color 0.12s;
  }
  .cog-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
  .cog-btn :global(svg) {
    transition: transform 0.3s ease;
  }
  .cog-btn:hover :global(svg) {
    transform: rotate(45deg);
  }
</style>

