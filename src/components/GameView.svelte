<script lang="ts">
  import { onMount } from 'svelte'
  import GameBoard from './GameBoard.svelte'
  import ChatPanel from './ChatPanel.svelte'
  import { fetchResolvedLog } from '../lib/game'
  import type { GameState, Unit } from '../lib/game'
  import { replayFrames, type HistoryFrame } from '../lib/history'
  import { getMap } from '../lib/maps'
  import { boardFromUnits } from '../lib/adjudicator'
  import type { BoardState, Phase } from '../lib/adjudicator'

  export let game: GameState
  export let nation: string = ''

  $: map = getMap(game.map_id)

  let frames: HistoryFrame[] = []
  let cursor = 0
  let loaded = false

  // Authoritative current board: the snapshot if present, else the seeded opening.
  function liveBoard(): BoardState {
    if (game.snapshot) return game.snapshot as BoardState
    return boardFromUnits(map, game.units as Unit[], game.year, game.season, game.phase as Phase)
  }

  async function load() {
    let past: HistoryFrame[] = []
    try {
      // replayFrames' last frame is the reconstructed current board — drop it and
      // use the authoritative live board for the frontier instead.
      past = replayFrames(map, await fetchResolvedLog(game.id)).slice(0, -1)
    } catch {
      past = []
    }
    frames = [...past, { board: liveBoard(), orders: [] }]
    cursor = frames.length - 1 // default to the live phase
    loaded = true
  }
  onMount(load)

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
  <div class="game-shell">
    <GameBoard
    mapDef={map}
    gameId={game.id}
    units={frame.board.units}
    ownership={frame.board.supplyCenters}
    nation={isFrontier ? nation : ''}
    phase={frame.board.phase}
    season={frame.board.season}
    year={frame.board.year}
    ready={isFrontier && !!(nation && game.ready?.[nation])}
    dislodged={frame.board.dislodged}
    contested={frame.board.contested}
    supplyCenters={frame.board.supplyCenters}
    readOnly={!isFrontier}
    historyOrders={frame.orders}
    onPhaseBack={() => canBack && (cursor -= 1)}
    onPhaseForward={() => canForward && (cursor += 1)}
    canPhaseBack={canBack}
    canPhaseForward={canForward}
    seedKey={String(cursor)}
    />

    <!-- Press dock: live secret chat, available once nations are assigned. -->
    {#if nation && game.phase !== 'lobby'}
      <ChatPanel gameId={game.id} {nation} players={game.players} />
    {/if}
  </div>
{/if}

<style>
  /* Positioning context for the docked ChatPanel (absolute, bottom-left of the board). */
  .game-shell {
    position: relative;
    width: 100%;
    height: 100%;
  }
</style>
