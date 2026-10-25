<script lang="ts">
  // Bottom of the orders view: the player's secret vote on how the game ends — play on
  // for the solo, share an x-way tie, or concede. Once the game is over it instead
  // reveals how every power voted.
  import { onMount } from 'svelte'
  import type { PowerDefinition } from '../lib/mapDefinition'
  import { flagUrl } from '../lib/flags'
  import { findPower, powerName } from '../lib/powers'
  import { errorMessage } from '../lib/errors'
  import { fetchFinalVotes, fetchMyVote, setDrawVote, type DrawVote } from '../lib/draw'

  export let gameId: string
  /** The viewer's nation. */
  export let nation: string
  export let powers: PowerDefinition[]
  /** Played powers still on the board (the only ones a tie can include). */
  export let alive: string[]
  /** Every played power (for the end-of-game reveal). */
  export let nations: string[]
  /** The game is over: show everyone's final vote instead of the ballot. */
  export let complete = false

  const name = (n: string) => powerName(powers, n)
  const flag = (n: string) => flagUrl[findPower(powers, n)?.id ?? n]

  // The saved vote, and the one being edited.
  let saved: DrawVote = { kind: 'solo' }
  let kind: DrawVote['kind'] = 'solo'
  let picked: string[] = []
  let loading = true
  let saving = false
  let error = ''
  let finals: Record<string, DrawVote> | null = null

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
  $: others = alive.filter((n) => n !== nation)
  // A tie member who has since been eliminated just drops out (as on the server).
  $: tie = [nation, ...picked.filter((n) => alive.includes(n))]
  $: draft = (kind === 'tie' ? { kind, members: tie } : { kind }) as DrawVote
  $: same = describe(draft) === describe(saved)
  $: valid = kind !== 'tie' || tie.length > 1

  // Map order, so the same set always reads (and compares) the same way.
  const rank = (n: string) => powers.findIndex((p) => p.id === findPower(powers, n)?.id)

  function describe(v: DrawVote): string {
    if (v.kind === 'solo') return 'Play for the solo'
    if (v.kind === 'concede') return 'Concede'
    const members = v.members.filter((n) => alive.includes(n) || complete).sort((a, b) => rank(a) - rank(b))
    return `${members.length}-way tie: ${members.map(name).join(', ')}`
  }

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

<section class="draw" aria-labelledby="draw-title">
  {#if complete}
    <h4 id="draw-title">Final votes</h4>
    {#if finals}
      <ul class="finals">
        {#each nations as n (n)}
          <li>
            {#if flag(n)}<img src={flag(n)} alt="" width="20" height="20" />{/if}
            <span class="who">{name(n)}</span>
            <span class="what">{finals[n].kind === 'solo' ? 'Solo' : finals[n].kind === 'concede' ? 'Conceded' : describe(finals[n])}</span>
          </li>
        {/each}
      </ul>
    {:else if error}
      <p class="err">{error}</p>
    {/if}
  {:else}
    <h4 id="draw-title">End the game</h4>
    {#if loading}
      <p class="note">Loading your vote…</p>
    {:else if !isAlive}
      <p class="note">You've been eliminated, so you count as conceding.</p>
    {:else}
      <p class="current">Your vote: <strong>{describe(saved)}</strong></p>

      <div class="choices" role="radiogroup" aria-label="Your vote">
        {#each [['solo', 'Solo'], ['tie', 'Tie'], ['concede', 'Concede']] as [k, label] (k)}
          <button
            type="button"
            class="choice"
            class:on={kind === k}
            role="radio"
            aria-checked={kind === k}
            on:click={() => (kind = k as DrawVote['kind'])}
          >{label}</button>
        {/each}
      </div>

      {#if kind === 'tie'}
        <p class="note">Pick who shares the tie with you{tie.length > 1 ? ` — ${tie.length}-way` : ''}.</p>
        <div class="powers">
          <span class="power me" aria-label="{name(nation)} (you)">
            {#if flag(nation)}<img src={flag(nation)} alt="" width="18" height="18" />{/if}
            {name(nation)}
          </span>
          {#each others as n (n)}
            <button type="button" class="power" class:on={picked.includes(n)} aria-pressed={picked.includes(n)} on:click={() => toggle(n)}>
              {#if flag(n)}<img src={flag(n)} alt="" width="18" height="18" />{/if}
              {name(n)}
            </button>
          {/each}
        </div>
      {:else if kind === 'concede'}
        <p class="note">You accept any result that doesn't include you. If everyone else already agrees, the game ends at once.</p>
      {/if}

      <div class="actions">
        <button class="btn btn-primary btn-sm" disabled={same || !valid || saving} on:click={save}>
          {saving ? 'Saving…' : 'Save vote'}
        </button>
        {#if !same}<button class="link" type="button" on:click={() => reset(saved)}>Undo</button>{/if}
      </div>
      {#if error}<p class="err">{error}</p>{/if}
    {/if}
  {/if}
</section>

<style>
  .draw {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg-card);
  }
  h4 {
    margin: 0;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .current {
    margin: 0;
    font-size: 13.5px;
  }
  .choices {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
    padding: 3px;
    border-radius: 10px;
    background: var(--bg-hover);
  }
  .choice {
    min-height: 36px;
    border: none;
    border-radius: 8px;
    background: none;
    color: var(--text-secondary);
    font: 600 13px var(--font);
    cursor: pointer;
  }
  .choice.on {
    background: var(--bg-card);
    color: var(--text);
    box-shadow: var(--shadow-sm), 0 0 0 1px var(--border);
  }
  .powers {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .power {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 34px;
    padding: 0 10px 0 6px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: none;
    color: var(--text);
    font: 500 13px var(--font);
    cursor: pointer;
  }
  .power img {
    border-radius: 50%;
  }
  .power.on {
    border-color: var(--accent);
    background: var(--accent-subtle);
    color: var(--accent);
    font-weight: 600;
  }
  .power.me {
    border-style: dashed;
    cursor: default;
    color: var(--text-secondary);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .link {
    border: none;
    background: none;
    color: var(--accent);
    font: 600 13px var(--font);
    cursor: pointer;
    padding: 6px 0;
  }
  .note {
    padding-top: 8px;
    border-top: 1px solid var(--border);
  }
  .err {
    margin: 0;
    font-size: 12.5px;
    color: var(--red);
  }
  .finals {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .finals li {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13.5px;
  }
  .finals img {
    border-radius: 50%;
  }
  .who {
    flex: 1;
    font-weight: 600;
  }
  .what {
    color: var(--text-secondary);
  }
</style>
