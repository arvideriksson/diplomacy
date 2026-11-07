<script lang="ts">
  // Home: your games (most urgent first), open lobbies to join, games to watch, your
  // finished games and your sandboxes — flat rows split by hairlines, like the in-game
  // sidebar.
  import { games, gamesLoaded } from '../lib/game'
  import type { GameListItem } from '../lib/game'
  import { sandboxes, keptSandboxes } from '../lib/sandbox'
  import type { Sandbox } from '../lib/sandbox'
  import { maps, getMap } from '../lib/maps'
  import type { Snippet } from 'svelte'
  import { powerInfo } from '../lib/powers'
  import { victoryFor } from '../lib/adjudicator'
  import { isOrderPhase, roundLabel } from '../lib/phases'
  import { deadlineState, formatCountdown, nowStore } from '../lib/time'
  import { readDraftBackup } from '../lib/draftBackup'
  import Modal from './Modal.svelte'
  import Icon from './Icon.svelte'
  import Flag from './Flag.svelte'

  export let onSelectGame: (game: { id: string }) => void = () => {}
  export let onOpenSandbox: (id: string) => void = () => {}
  export let onCreateSandbox: (name: string, mapId: string) => void = () => {}

  /** Rows in Watch before "All N" expands it. */
  const WATCH_PREVIEW = 5

  // Countdowns re-render twice a minute.
  const now = nowStore(30_000)

  // The viewer's order state in an active game: 'todo', 'done', 'unsent' (submitted, but
  // edited on this device since), or null.
  function orderStatus(game: GameListItem): 'todo' | 'done' | 'unsent' | null {
    const nation = game.me?.nation
    if (!nation || !isOrderPhase(game.phase)) return null
    if (!game.ready?.[nation]) return 'todo'
    const edits = readDraftBackup({ gameId: game.id, nation, year: game.year, season: game.season, phase: game.phase })
    return edits ? 'unsent' : 'done'
  }

  /** "5h 12m", "3d 4h", "40m": time to the deadline (the grace period's end once it has
   *  passed), or null without one. */
  function left(game: GameListItem, at: number): string | null {
    const { msLeft } = deadlineState(game.deadline, game.grace_ends_at ?? null, at)
    return msLeft == null ? null : formatCountdown(msLeft, { suffix: false, seconds: false })
  }

  const seats = (g: GameListItem) => getMap(g.map_id).powers.length
  const color = (g: GameListItem, nation: string) => powerInfo(getMap(g.map_id), nation).color
  const name = (g: GameListItem, nation: string) => powerInfo(getMap(g.map_id), nation).name

  /** "Fall 1903 · Movement", with the map named when it isn't the classical one. */
  function when(g: GameListItem): string {
    const map = g.map_id && g.map_id !== 'classical' ? ` · ${maps[g.map_id]?.name ?? g.map_id}` : ''
    if (g.phase === 'lobby') return `Lobby${map}`
    if (g.phase === 'complete') return `${roundLabel(g, 'Ended')}${map}`
    return `${isOrderPhase(g.phase) ? roundLabel(g) : roundLabel(g, 'Resolving')}${map}`
  }

  /** How a finished game ended: a tie, a concession, or a solo (or shared win) from the final board. */
  function outcome(g: GameListItem): { kind: 'won' | 'tie'; nations: string[] } | null {
    if (g.result?.kind === 'draw') return { kind: 'tie', nations: g.result.nations }
    if (g.result?.kind === 'concession' || g.result?.kind === 'victory') return { kind: 'won', nations: g.result.nations }
    if (g.final_centers) {
      const v = victoryFor(getMap(g.map_id), g.final_centers)
      if (v) return { kind: 'won', nations: v.shared ?? [v.nation] }
    }
    return null
  }

  // Most urgent first: orders due (soonest deadline first), then submitted games, then
  // lobbies.
  function urgency(g: GameListItem): number {
    const s = orderStatus(g)
    if (s === 'todo' || s === 'unsent') return 0
    if (isOrderPhase(g.phase)) return 1
    return 2
  }
  const deadlineOf = (g: GameListItem) => (g.deadline ? Date.parse(g.deadline) : Infinity)

  // Categorize remote games relative to the current player.
  const joined = (g: GameListItem) => !!g.me
  $: myGames = $games
    .filter((g) => joined(g) && g.phase !== 'complete')
    .sort((a, b) => urgency(a) - urgency(b) || deadlineOf(a) - deadlineOf(b))
  $: finished = $games.filter((g) => joined(g) && g.phase === 'complete')
  // Full lobbies can't be joined, so they aren't "open".
  $: openGames = $games.filter((g) => !joined(g) && g.phase === 'lobby' && g.player_count < seats(g))
  $: watchGames = $games.filter((g) => !joined(g) && g.phase !== 'lobby' && g.phase !== 'complete')
  let watchAll = false
  $: watchShown = watchAll ? watchGames : watchGames.slice(0, WATCH_PREVIEW)
  $: kept = keptSandboxes($sandboxes)

  const sandboxName = (s: Sandbox) => (s.origin ? `${s.origin.gameName} · ${s.name}` : s.name)
  function sandboxWhen(s: Sandbox): string {
    return roundLabel(s.frames[s.cursor].board)
  }

  // Maps available for sandboxes, e.g. [['classical', 'Classical'], ['1900', '1900']].
  const mapOptions = Object.entries(maps).map(([id, def]) => [id, def.name] as const)

  // Sandbox-name modal.
  let showNewSandbox = false
  let sandboxNameInput = ''
  let sandboxMapId = 'classical'
  let sandboxInput: HTMLInputElement | undefined

  function openNewSandbox() {
    sandboxNameInput = 'Test game'
    sandboxMapId = 'classical'
    showNewSandbox = true
    // Focus + select the prefilled name once the modal mounts.
    queueMicrotask(() => sandboxInput?.select())
  }

  function confirmNewSandbox() {
    onCreateSandbox(sandboxNameInput.trim() || 'Test game', sandboxMapId)
    showNewSandbox = false
  }

  // Rows are real links (middle-click, open in new tab); a plain click navigates in-app.
  const follow = (open: () => void) => (e: MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    open()
  }
</script>

<!-- Seat pips: one square per power, filled for each player in the game. -->
{#snippet pips(g: GameListItem)}
  <span class="pips" aria-hidden="true">
    {#each Array(seats(g)) as _, i (i)}<i class:on={i < g.player_count}></i>{/each}
  </span>
{/snippet}

<!-- One row: power edge, lead glyph, name and meta, status, then › or Join. -->
{#snippet row(
  href: string,
  open: () => void,
  lead: Snippet,
  name: string,
  meta: string,
  status?: Snippet,
  opts: { edge?: string; lock?: boolean; join?: boolean } = {},
)}
  <a class="row" {href} on:click={follow(open)}>
    <span class="edge" style:background={opts.edge}></span>
    {@render lead()}
    <span class="text">
      <span class="name">{name}{#if opts.lock}<span class="lock" title="Private"><Icon name="lock" size={12} /></span>{/if}</span>
      <span class="meta">{meta}</span>
    </span>
    <span class="status">{@render status?.()}</span>
    {#if opts.join}
      <span class="join">Join</span>
    {:else}
      <span class="chev"><Icon name="chevron-right" size={16} /></span>
    {/if}
  </a>
{/snippet}

{#snippet glyph(name: 'users' | 'plus' | 'eye' | 'flask')}
  <span class="glyph">
    {#if name === 'plus'}<Icon name="plus" size={14} strokeWidth={2.4} round />{:else}<Icon {name} size={14} round={name === 'flask'} />{/if}
  </span>
{/snippet}

<!-- One of your games: your power's edge and flag, then what it's waiting on. -->
{#snippet myRow(g: GameListItem)}
  {@const nation = g.me?.nation ?? ''}
  {@const status = orderStatus(g)}
  {@const end = g.phase === 'complete' ? outcome(g) : null}
  {#snippet lead()}
    {#if nation}<Flag powers={getMap(g.map_id)} {nation} size={26} />{:else}{@render glyph('users')}{/if}
  {/snippet}
  {#snippet state()}
    {#if g.phase === 'lobby'}
      {@render pips(g)}
      <span class="sub">{g.player_count} of {seats(g)}</span>
    {:else if g.phase === 'complete'}
      {#if end}
        <span class="main">
          <span class="flags">{#each end.nations as n (n)}<Flag powers={getMap(g.map_id)} nation={n} size={16} />{/each}</span>
          {end.kind === 'won' ? (end.nations.length > 1 ? 'Shared win' : 'Won') : `${end.nations.length}-way tie`}
        </span>
        <span class="sub">{end.kind === 'won' ? end.nations.map((n) => name(g, n)).join(' & ') : 'Agreed'}</span>
      {:else}
        <span class="main quiet">Ended</span>
      {/if}
    {:else if status === 'todo' || status === 'unsent'}
      <span class="main due">{left(g, $now) ?? 'Now'}</span>
      <span class="sub">{status === 'todo' ? 'Orders due' : 'Changes not sent'}</span>
    {:else if isOrderPhase(g.phase)}
      {#if left(g, $now)}<span class="main quiet">{left(g, $now)}</span>{/if}
      <span class="sub">Submitted</span>
    {/if}
  {/snippet}
  {@render row(`/game/${g.id}`, () => onSelectGame(g), lead, g.name, when(g), state, { edge: nation ? color(g, nation) : 'transparent', lock: g.is_private })}
{/snippet}

<div class="home">
  {#if $gamesLoaded}
    <section>
      <h2>Your games</h2>
      {#if myGames.length}
        <div class="list">
          {#each myGames as g (g.id)}{@render myRow(g)}{/each}
        </div>
      {:else}
        <p class="empty">You haven’t joined any games yet.</p>
      {/if}
    </section>

    <section>
      <h2>Open games</h2>
      {#if openGames.length}
        <div class="list">
          {#each openGames as g (g.id)}
            {#snippet lead()}{@render glyph('plus')}{/snippet}
            {#snippet seatsLeft()}
              {@render pips(g)}
              <span class="sub">{seats(g) - g.player_count} {seats(g) - g.player_count === 1 ? 'seat' : 'seats'} left</span>
            {/snippet}
            {@render row(`/game/${g.id}`, () => onSelectGame(g), lead, g.name, when(g), seatsLeft, { join: true })}
          {/each}
        </div>
      {:else}
        <p class="empty">No open games right now.</p>
      {/if}
    </section>

    <section>
      <div class="head">
        <h2>Watch</h2>
        {#if watchGames.length > WATCH_PREVIEW}
          <button class="link" type="button" on:click={() => (watchAll = !watchAll)}>
            {watchAll ? 'Show fewer' : `All ${watchGames.length}`}
          </button>
        {/if}
      </div>
      {#if watchGames.length}
        <div class="list">
          {#each watchShown as g (g.id)}
            {#snippet lead()}{@render glyph('eye')}{/snippet}
            {@render row(`/game/${g.id}`, () => onSelectGame(g), lead, g.name, when(g))}
          {/each}
        </div>
      {:else}
        <p class="empty">No games in progress.</p>
      {/if}
    </section>

    {#if finished.length}
      <section>
        <h2>Finished</h2>
        <div class="list">
          {#each finished as g (g.id)}{@render myRow(g)}{/each}
        </div>
      </section>
    {/if}

    <section>
      <div class="head">
        <h2>Sandboxes</h2>
        <button class="link" type="button" on:click={openNewSandbox}>New sandbox</button>
      </div>
      {#if kept.length}
        <div class="list">
          {#each kept as s (s.id)}
            {#snippet lead()}{@render glyph('flask')}{/snippet}
            {@render row(`/sandbox/${s.id}`, () => onOpenSandbox(s.id), lead, sandboxName(s), sandboxWhen(s))}
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</div>

{#if showNewSandbox}
  <Modal title="New sandbox" top="96px" onClose={() => (showNewSandbox = false)}>
    <label class="field-label" for="sandbox-name">Name</label>
    <input
      id="sandbox-name"
      bind:this={sandboxInput}
      bind:value={sandboxNameInput}
      class="input"
      placeholder="Sandbox name"
      on:keydown={(e) => e.key === 'Enter' && confirmNewSandbox()}
    />
    <label class="field-label" for="sandbox-map">Map</label>
    <div class="select-wrap">
      <select id="sandbox-map" bind:value={sandboxMapId} class="input map-select">
        {#each mapOptions as [id, label] (id)}
          <option value={id}>{label}</option>
        {/each}
      </select>
      <span class="select-chevron"><Icon name="chevron-down" size={16} /></span>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" on:click={() => (showNewSandbox = false)}>Cancel</button>
      <button class="btn btn-primary" on:click={confirmNewSandbox} disabled={!sandboxNameInput.trim()}>
        Create sandbox
      </button>
    </div>
  </Modal>
{/if}

<style>
  .home {
    display: flex;
    flex-direction: column;
    gap: 28px;
    width: 100%;
  }
  section {
    display: flex;
    flex-direction: column;
  }
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
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
  .link {
    padding: 0 2px;
    border: none;
    background: none;
    color: var(--accent);
    font: 600 13px var(--font);
    cursor: pointer;
  }
  .empty {
    margin: 0;
    padding: 2px 2px 0;
    font-size: 13px;
    color: var(--text-tertiary);
  }

  /* Flat rows split by hairlines; the edge carries your power's color. */
  .list {
    background: var(--bg-card);
    border: 1px solid var(--border);
  }
  .row {
    display: grid;
    color: inherit;
    text-decoration: none;
    grid-template-columns: 3px 26px minmax(0, 1fr) auto minmax(16px, auto);
    column-gap: 12px;
    align-items: center;
    min-height: 58px;
    padding: 8px 14px 8px 0;
    border-top: 1px solid var(--border);
    cursor: pointer;
    outline: none;
  }
  .row:first-child {
    border-top: none;
  }
  @media (hover: hover) {
    .row:hover {
      background: var(--bg-hover);
    }
  }
  .row:focus-visible {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .edge {
    align-self: stretch;
    margin: -8px 0;
  }
  .edge[style*='background']:not([style*='transparent']) {
    box-shadow: inset 0 0 0 1px var(--power-edge-line);
  }
  .glyph {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--bg-fill);
    color: var(--text-tertiary);
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .name {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text);
  }
  .lock {
    display: flex;
    flex: none;
    color: var(--text-tertiary);
  }
  .meta {
    font-size: 12.5px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .status {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 1px;
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    text-align: right;
  }
  .main {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    color: var(--text);
  }
  .main.quiet {
    font-weight: 500;
    color: var(--text-secondary);
  }
  .main.due {
    color: var(--amber);
  }
  .main.due::before {
    content: '';
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--amber);
  }
  .sub {
    font-size: 12px;
    color: var(--text-tertiary);
  }
  .flags {
    display: inline-flex;
  }
  .flags > :global(.flag + .flag) {
    margin-left: -4px;
  }
  .pips {
    display: inline-flex;
    gap: 3px;
    padding: 3px 0;
  }
  .pips i {
    width: 7px;
    height: 7px;
    background: var(--bg-fill);
  }
  .pips i.on {
    background: var(--text-secondary);
  }
  .chev {
    display: flex;
    color: var(--text-tertiary);
  }
  .join {
    font-size: 13px;
    font-weight: 600;
    color: var(--accent);
  }

  @media (max-width: 600px) {
    /* Rows run edge to edge on phones (App's main has 16px gutters). */
    .list {
      margin: 0 -16px;
      border-left: none;
      border-right: none;
    }
    .modal-actions .btn {
      flex: 1;
    }
  }

  .field-label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 14px 0 6px;
  }
  .field-label:first-of-type {
    margin-top: 0;
  }
  .select-wrap {
    position: relative;
  }
  .map-select {
    padding-right: 36px;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
  }
  .select-chevron {
    display: flex;
    position: absolute;
    right: 11px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-tertiary);
    pointer-events: none;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
  }
</style>
