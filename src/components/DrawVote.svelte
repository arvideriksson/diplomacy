<script lang="ts">
  // Bottom of the orders view: the player's secret vote on how the game ends — play on
  // for the solo, share an x-way tie, or concede. Once the game is over it instead
  // reveals how every power voted.
  import { onMount } from 'svelte'
  import type { MapDefinition } from '../lib/mapDefinition'
  import { victoryThreshold } from '../lib/adjudicator/resolve'
  import { flagUrl } from '../lib/flags'
  import { findPower, powerName } from '../lib/powers'
  import { errorMessage } from '../lib/errors'
  import { fetchFinalVotes, fetchMyVote, setDrawVote, type DrawVote } from '../lib/draw'

  export let gameId: string
  /** The viewer's nation. */
  export let nation: string
  /** The board's map: its powers (in map order) and victory rule. */
  export let map: MapDefinition
  /** Played powers still on the board (the only ones a tie can include). */
  export let alive: string[]
  /** Every played power (for the end-of-game reveal). */
  export let nations: string[]
  /** The game is over: show everyone's final vote instead of the ballot. */
  export let complete = false

  $: win = victoryThreshold(map)
  const name = (n: string) => powerName(map.powers, n)
  const color = (n: string) => findPower(map.powers, n)?.color ?? 'var(--border-strong)'
  const flag = (n: string) => flagUrl[findPower(map.powers, n)?.id ?? n]

  // The saved vote, and the one being edited.
  let saved: DrawVote = { kind: 'solo' }
  let kind: DrawVote['kind'] = 'solo'
  let picked: string[] = []
  let loading = true
  let saving = false
  let error = ''
  let finals: Record<string, DrawVote> | null = null
  // The ballot is a rare action: folded to a one-line summary until opened.
  let open = false

  onMount(async () => {
    try {
      if (complete) finals = await fetchFinalVotes(gameId, nations)
      else reset((saved = await fetchMyVote(gameId, nation)))
    } catch (e) {
      error = errorMessage(e)
    }
    loading = false
  })

  function reset(v: DrawVote) {
    kind = v.kind
    picked = v.kind === 'tie' ? v.members.filter((n) => n !== nation) : []
  }

  $: isAlive = alive.includes(nation)
  $: others = alive.filter((n) => n !== nation).sort((a, b) => rank(a) - rank(b))
  // A tie member who has since been eliminated just drops out (as on the server).
  $: tie = [nation, ...picked.filter((n) => alive.includes(n))]
  $: draft = (kind === 'tie' ? { kind, members: tie } : { kind }) as DrawVote
  $: same = describe(draft) === describe(saved)
  $: valid = kind !== 'tie' || tie.length > 1

  // Map order, so the same set always reads (and compares) the same way.
  const rank = (n: string) => map.powers.findIndex((p) => p.id === findPower(map.powers, n)?.id)

  function describe(v: DrawVote): string {
    if (v.kind === 'solo') return 'Play for the solo'
    if (v.kind === 'concede') return 'Concede'
    const members = v.members.filter((n) => alive.includes(n) || complete).sort((a, b) => rank(a) - rank(b))
    return `${members.length}-way tie: ${members.map(name).join(', ')}`
  }

  const label = (v: DrawVote): string =>
    v.kind === 'solo' ? 'Solo' : v.kind === 'concede' ? 'Concede' : `${v.members.length}-way tie`
  const finalLabel = (v: DrawVote): string => (v.kind === 'concede' ? 'Conceded' : label(v))

  $: options = [
    { kind: 'solo', title: 'Play for the solo', detail: `Keep playing until someone holds ${win} centers.` },
    { kind: 'tie', title: 'Agree to a tie', detail: 'Share the win with the powers you pick. Everyone in the tie has to pick the same set.' },
    { kind: 'concede', title: 'Concede', detail: "Accept any result that leaves you out. If everyone else already agrees, the game ends at once." },
  ] as const

  function toggle(n: string) {
    picked = picked.includes(n) ? picked.filter((x) => x !== n) : [...picked, n]
  }

  async function save() {
    saving = true
    error = ''
    try {
      await setDrawVote(gameId, draft)
      saved = draft
    } catch (e) {
      error = errorMessage(e)
    }
    saving = false
  }
</script>

<!-- Flat "ledger" rows like the supply-center standings above: flush to the sidebar's
     edges, hairline dividers, a square color edge on each power. -->
<section class="draw" aria-labelledby="draw-title">
  {#if complete}
    <div class="head static">
      <h4 id="draw-title">Final votes</h4>
    </div>
    {#if finals}
      <ul class="rows">
        {#each [...nations].sort((a, b) => rank(a) - rank(b)) as n (n)}
          <li class="power-row" style="--c:{color(n)}">
            <span class="edge"></span>
            {#if flag(n)}<img class="flag" src={flag(n)} alt="" width="22" height="22" />{:else}<span></span>{/if}
            <span class="name">{name(n)}</span>
            <span class="verdict" class:tie={finals[n].kind === 'tie'} title={finals[n].kind === 'tie' ? describe(finals[n]) : undefined}>{finalLabel(finals[n])}</span>
          </li>
        {/each}
      </ul>
    {:else if error}
      <p class="msg err">{error}</p>
    {/if}
  {:else}
    <button class="head" type="button" aria-expanded={open} on:click={() => (open = !open)}>
      <h4 id="draw-title">End the game</h4>
      <span class="sum">
        {#if loading}…{:else if !isAlive}Eliminated{:else}Your vote: <b>{label(saved)}</b>{/if}
      </span>
      <svg class="chevron" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 6l4 4 4-4" />
      </svg>
    </button>
    {#if !open}
      <!-- folded -->
    {:else if loading}
      <p class="msg">Loading your vote…</p>
    {:else if !isAlive}
      <p class="msg">You've been eliminated, so you count as conceding.</p>
    {:else}
      <div role="radiogroup" aria-label="Your vote">
        {#each options as o (o.kind)}
          <button
            type="button"
            class="option"
            class:on={kind === o.kind}
            role="radio"
            aria-checked={kind === o.kind}
            on:click={() => (kind = o.kind)}
          >
            <span class="radio" aria-hidden="true"></span>
            <span class="option-text">
              <span class="option-title">{o.title}</span>
              <span class="option-detail">{o.detail}</span>
            </span>
          </button>
          {#if o.kind === 'tie' && kind === 'tie'}
            <!-- The tie being built: you're always in it; tick the others. -->
            <div class="members" role="group" aria-label="Powers in the tie">
              <div class="power-row me" style="--c:{color(nation)}">
                <span class="edge"></span>
                {#if flag(nation)}<img class="flag" src={flag(nation)} alt="" width="18" height="18" />{:else}<span></span>{/if}
                <span class="name">{name(nation)} <span class="you">(you)</span></span>
                <span class="box on" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" /></svg></span>
              </div>
              {#each others as n (n)}
                <button type="button" class="power-row pick" class:on={picked.includes(n)} style="--c:{color(n)}" aria-pressed={picked.includes(n)} on:click={() => toggle(n)}>
                  <span class="edge"></span>
                  {#if flag(n)}<img class="flag" src={flag(n)} alt="" width="18" height="18" />{:else}<span></span>{/if}
                  <span class="name">{name(n)}</span>
                  <span class="box" class:on={picked.includes(n)} aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" /></svg></span>
                </button>
              {/each}
              <div class="tally" aria-live="polite">
                {#if tie.length > 1}<span>Tie between</span><b>{tie.length} powers</b>{:else}<span>Pick at least one other power</span>{/if}
              </div>
            </div>
          {/if}
        {/each}
      </div>

      <div class="foot">
        <span class="status">{saving ? 'Saving…' : same ? 'Saved' : 'Not saved yet'}</span>
        {#if !same}<button class="link" type="button" on:click={() => reset(saved)}>Undo</button>{/if}
        <button class="btn btn-primary btn-sm" disabled={same || !valid || saving} on:click={save}>Save vote</button>
      </div>
      {#if error}<p class="msg err">{error}</p>{/if}
    {/if}
  {/if}
</section>

<style>
  .draw {
    font-size: 14px;
  }
  /* The fold row, lit on hover like the Sandbox / Supply Centers rows beside it. */
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 40px;
    padding: 10px 14px;
    border: none;
    background: none;
    color: var(--text-secondary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .head.static {
    cursor: default;
  }
  @media (hover: hover) {
    button.head:hover {
      background: var(--bg-hover);
    }
  }
  h4 {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .sum {
    flex: none;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-tertiary);
    white-space: nowrap;
  }
  .sum b {
    font-weight: 700;
    color: var(--text-secondary);
  }
  .chevron {
    flex: none;
    color: var(--text-tertiary);
    transform: rotate(-90deg);
    transition: transform 0.15s ease;
  }
  .head[aria-expanded='true'] .chevron {
    transform: none;
  }

  /* One radio row per choice, each with a line saying what it means. */
  .option {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr);
    column-gap: 12px;
    align-items: start;
    width: 100%;
    padding: 10px 14px;
    border: none;
    border-top: 1px solid var(--border);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  @media (hover: hover) {
    .option:hover {
      background: var(--bg-hover);
    }
  }
  .option.on {
    background: var(--accent-subtle);
  }
  .radio {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    margin-top: 2px;
    border: 1.5px solid var(--border-strong);
    border-radius: 50%;
  }
  .option.on .radio {
    border-color: var(--accent);
  }
  .option.on .radio::after {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
  }
  .option-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .option-title {
    font-weight: 600;
  }
  .option-detail {
    font-size: 12.5px;
    color: var(--text-secondary);
  }

  /* Power rows: the tie checklist and the final reveal share the standings' shape. */
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .power-row {
    display: grid;
    grid-template-columns: 3px 22px minmax(0, 1fr) auto;
    column-gap: 11px;
    align-items: center;
    width: 100%;
    height: 38px;
    padding: 0 14px 0 0;
    border: none;
    border-top: 1px solid var(--border);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
  }
  .members .power-row {
    height: 36px;
  }
  /* Indent the checklist's flags under the option text (past the radio column). */
  .members .power-row .flag {
    margin-left: 17px;
  }
  .members .power-row {
    grid-template-columns: 3px 35px minmax(0, 1fr) 16px;
    column-gap: 8px;
  }
  .edge {
    align-self: stretch;
    background: var(--c);
  }
  .flag {
    display: block;
  }
  .name {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .members .name {
    font-weight: 500;
  }
  .members .me .name {
    color: var(--text-secondary);
  }
  .you {
    font-weight: 400;
    color: var(--text-tertiary);
  }
  .pick {
    cursor: pointer;
  }
  @media (hover: hover) {
    .pick:hover {
      background: var(--bg-hover);
    }
  }
  .box {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border: 1.5px solid var(--border-strong);
    border-radius: 4px;
  }
  .box svg {
    display: none;
    width: 12px;
    height: 12px;
    fill: none;
    stroke: var(--text-inverse);
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .box.on {
    border-color: var(--accent);
    background: var(--accent);
  }
  .box.on svg {
    display: block;
  }
  .me .box {
    opacity: 0.5;
  }
  .tally {
    display: flex;
    justify-content: space-between;
    padding: 7px 14px;
    border-top: 1px solid var(--border);
    background: var(--bg-hover);
    font-size: 12px;
    color: var(--text-tertiary);
  }
  .tally b {
    color: var(--text-secondary);
  }
  .verdict {
    font-size: 13px;
    color: var(--text-secondary);
  }
  .verdict.tie {
    font-weight: 600;
    color: var(--accent);
  }

  .foot {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px 12px;
    border-top: 1px solid var(--border);
  }
  .status {
    flex: 1;
    font-size: 12px;
    color: var(--text-tertiary);
  }
  .link {
    padding: 6px 0;
    border: none;
    background: none;
    color: var(--accent);
    font: 600 13px var(--font);
    cursor: pointer;
  }
  .msg {
    margin: 0;
    padding: 10px 14px 12px;
    border-top: 1px solid var(--border);
    font-size: 12.5px;
    color: var(--text-secondary);
  }
  .err {
    color: var(--red);
  }
</style>
