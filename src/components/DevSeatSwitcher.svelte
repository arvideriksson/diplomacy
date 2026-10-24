<script lang="ts">
  // Dev-only floating panel: hop between the seven test seats in this tab (Alt+1…7),
  // fill the open lobby with seats, and ready every other seat's orders. Mounted only
  // under import.meta.env.DEV (see App.svelte), so it's tree-shaken from production.
  import { useLocation } from 'svelte-routing'
  import { currentGame, fetchGame } from '../lib/game'
  import { activeDevSeat } from '../lib/supabase'
  import { SEATS, seatUser, switchSeat, fillLobby, readyOtherSeats } from '../lib/devSeats'
  import { flagUrl } from '../lib/flags'

  const location = useLocation()
  const active = activeDevSeat()

  let open = false
  let busy = ''
  let message = ''

  // The game on screen, if any (currentGame lingers after leaving a game route).
  $: game = $currentGame && $location.pathname.startsWith(`/game/${$currentGame.id}`) ? $currentGame : null
  $: seats = SEATS.map((seat) => {
    const u = seatUser(seat)
    const nation = u && game ? game.players[u.id]?.nation : undefined
    return { seat, user: u, nation, ready: !!(nation && game?.ready?.[nation]) }
  })
  $: activeNation = seats[active - 1]?.nation
  $: inPlay = game && ['movement', 'retreat', 'build'].includes(game.phase)

  async function run(label: string, fn: () => Promise<string | void>) {
    busy = label
    message = ''
    try {
      message = (await fn()) || ''
    } catch (e: any) {
      message = e?.message ?? String(e)
    } finally {
      busy = ''
    }
  }

  const choose = (seat: number) => run(`Switching to seat ${seat}…`, () => switchSeat(seat))

  const fill = () =>
    run('Filling lobby…', async () => {
      await fillLobby(game!)
      await fetchGame(game!.id)
      return 'Lobby filled.'
    })

  const readyOthers = () =>
    run('Readying other seats…', async () => {
      const nations = await readyOtherSeats(game!)
      return nations.length ? `Readied ${nations.join(', ')}.` : 'Nothing left to ready.'
    })

  function onKey(e: KeyboardEvent) {
    if (!e.altKey || e.ctrlKey || e.metaKey) return
    const seat = Number(e.key)
    if (SEATS.includes(seat) && seat !== active) {
      e.preventDefault()
      choose(seat)
    }
  }
</script>

<svelte:window on:keydown={onKey} />

<div class="dev-seats">
  {#if open}
    <div class="panel">
      <div class="head">
        <span>Test seats</span>
        <span class="hint">Alt+1…7</span>
      </div>
      <ul>
        {#each seats as s (s.seat)}
          <li>
            <button class="seat" class:active={s.seat === active} disabled={!!busy || s.seat === active} on:click={() => choose(s.seat)}>
              <span class="num">{s.seat}</span>
              {#if s.nation && flagUrl[s.nation]}
                <img src={flagUrl[s.nation]} alt="" class="flag" />
              {/if}
              <span class="label">
                {#if s.nation}<span class="nation">{s.nation}</span>{/if}
                <span class="name">{s.user?.name ?? 'empty — click to sign in'}</span>
              </span>
              {#if s.ready}<span class="ready" title="Ready">✓</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
      {#if game?.phase === 'lobby'}
        <button class="action" disabled={!!busy} on:click={fill}>Fill lobby with seats</button>
      {:else if inPlay}
        <button class="action" disabled={!!busy} on:click={readyOthers}>Ready all other seats</button>
      {/if}
      {#if busy || message}
        <p class="msg">{busy || message}</p>
      {/if}
    </div>
  {/if}
  <button class="pill" on:click={() => (open = !open)} title="Dev test seats">
    🧪 Seat {active}{#if activeNation}{` · ${activeNation}`}{/if}
  </button>
</div>

<style>
  .dev-seats {
    position: fixed;
    left: 16px;
    bottom: 16px;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    font-family: var(--font);
    font-size: 13px;
  }

  .pill,
  .panel {
    background: color-mix(in srgb, var(--bg-elevated) 92%, transparent);
    backdrop-filter: blur(16px) saturate(1.5);
    -webkit-backdrop-filter: blur(16px) saturate(1.5);
    border: 1px dashed var(--amber);
    box-shadow: var(--shadow-lg);
    color: var(--text);
  }

  .pill {
    padding: 6px 12px;
    border-radius: var(--radius-full);
    font: inherit;
    font-weight: 600;
    text-transform: capitalize;
    cursor: pointer;
  }

  .panel {
    width: 260px;
    padding: 10px;
    border-radius: var(--radius-lg);
  }

  .head {
    display: flex;
    justify-content: space-between;
    padding: 2px 6px 8px;
    font-weight: 600;
  }

  .hint {
    color: var(--text-tertiary);
    font-weight: 400;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .seat {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .seat:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .seat.active {
    background: var(--amber-subtle);
    cursor: default;
  }

  .seat:disabled:not(.active) {
    opacity: 0.6;
    cursor: wait;
  }

  .num {
    width: 18px;
    text-align: center;
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
  }

  .flag {
    width: 18px;
    height: 18px;
  }

  .label {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .nation {
    font-weight: 600;
    text-transform: capitalize;
  }

  .name {
    color: var(--text-secondary);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ready {
    color: var(--green);
    font-weight: 700;
  }

  .action {
    width: 100%;
    margin-top: 8px;
    padding: 8px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--text);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .action:hover:not(:disabled) {
    border-color: var(--amber);
  }

  .action:disabled {
    opacity: 0.6;
    cursor: wait;
  }

  .msg {
    margin: 8px 6px 2px;
    color: var(--text-secondary);
    font-size: 12px;
  }
</style>
