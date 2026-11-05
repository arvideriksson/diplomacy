<script lang="ts">
  // The lobby's seat list, in the flat-row style of the home screen and standings.
  // Chosen powers: one row per power, the player holding it or Open (members take a
  // seat with Take). Random powers: numbered seats marked "?" in join order; the powers
  // are dealt when the game starts. The host removes players with ×.
  import type { PlayerInfo } from '../lib/game'
  import type { PowerDefinition } from '../lib/mapDefinition'
  import { flagUrl } from '../lib/flags'
  import Icon from './Icon.svelte'

  export let players: Record<string, PlayerInfo>
  export let powers: PowerDefinition[]
  export let randomNations: boolean
  export let hostId: string
  export let userId: string | undefined
  /** The viewer is the host. */
  export let isAdmin: boolean
  /** The viewer is in the game (can take a seat). */
  export let isMember: boolean
  export let onClaim: (nation: string) => void
  export let onKick: (playerId: string) => void

  type Seated = { uid: string; info: PlayerInfo }
  const name = (p: PlayerInfo | undefined) => p?.display_name ?? 'Anonymous'

  $: entries = Object.entries(players)
    .map(([uid, info]) => ({ uid, info }))
    .sort((a, b) => a.info.joined_at.localeCompare(b.info.joined_at))
  $: byNation = Object.fromEntries(entries.filter((e) => e.info.nation).map((e) => [e.info.nation!, e])) as Record<string, Seated>
  // In a chosen-powers lobby, members who haven't picked a power yet.
  $: unseated = randomNations ? [] : entries.filter((e) => !e.info.nation || !powers.some((p) => p.id === e.info.nation))
  // Random: seat N is the Nth player to join.
  $: randomSeats = Array.from({ length: powers.length }, (_, i) => entries[i] ?? null)
</script>

<div class="seats">
  {#if randomNations}
    {#each randomSeats as seat, i (i)}
      <div class="seat" class:open={!seat} class:mine={seat?.uid === userId}>
        <span class="edge"></span>
        <span class="random" aria-hidden="true">?</span>
        <span class="text">
          <span class="title">{seat ? name(seat.info) : 'Open seat'}{#if seat?.uid === userId}<span class="you">{' (you)'}</span>{/if}{#if seat?.uid === hostId}<span class="tag">Host</span>{/if}</span>
          <span class="sub">{seat ? 'Power dealt at the start' : `Seat ${i + 1}`}</span>
        </span>
        {#if seat && isAdmin && seat.uid !== userId}
          <button class="kick" type="button" title="Remove {name(seat.info)}" aria-label="Remove {name(seat.info)}" on:click={() => onKick(seat.uid)}>
            <Icon name="close" size={14} />
          </button>
        {:else}
          <span></span>
        {/if}
      </div>
    {/each}
  {:else}
    {#each powers as p (p.id)}
      {@const holder = byNation[p.id]}
      <div class="seat" class:open={!holder} class:mine={holder?.uid === userId} style="--c:{p.color}">
        <span class="edge" style:background={p.color}></span>
        {#if flagUrl[p.id]}
          <img class="flag" src={flagUrl[p.id]} alt="" width="26" height="26" />
        {:else}
          <span class="dot" style:background={p.color}></span>
        {/if}
        <span class="text">
          <span class="title">{p.name}</span>
          <span class="sub">
            {#if holder}{name(holder.info)}{#if holder.uid === userId}{' (you)'}{/if}{#if holder.uid === hostId}<span class="tag">Host</span>{/if}{:else}Open{/if}
          </span>
        </span>
        {#if holder}
          {#if isAdmin && holder.uid !== userId}
            <button class="kick" type="button" title="Remove {name(holder.info)}" aria-label="Remove {name(holder.info)}" on:click={() => onKick(holder.uid)}>
              <Icon name="close" size={14} />
            </button>
          {:else}
            <span></span>
          {/if}
        {:else if isMember}
          <button class="take" type="button" on:click={() => onClaim(p.id)}>Take</button>
        {:else}
          <span></span>
        {/if}
      </div>
    {/each}
    {#each unseated as e (e.uid)}
      <div class="seat waiting" class:mine={e.uid === userId}>
        <span class="edge"></span>
        <span class="random" aria-hidden="true">?</span>
        <span class="text">
          <span class="title">{name(e.info)}{#if e.uid === userId}<span class="you">{' (you)'}</span>{/if}{#if e.uid === hostId}<span class="tag">Host</span>{/if}</span>
          <span class="sub">Choosing a power</span>
        </span>
        {#if isAdmin && e.uid !== userId}
          <button class="kick" type="button" title="Remove {name(e.info)}" aria-label="Remove {name(e.info)}" on:click={() => onKick(e.uid)}>
            <Icon name="close" size={14} />
          </button>
        {:else}
          <span></span>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .seat {
    display: grid;
    grid-template-columns: 3px 26px minmax(0, 1fr) auto;
    column-gap: 12px;
    align-items: center;
    min-height: 52px;
    padding: 6px 14px 6px 0;
    border-top: 1px solid var(--border);
  }
  .seat:first-child {
    border-top: none;
  }
  .edge {
    align-self: stretch;
    margin: -6px 0;
  }
  .flag {
    display: block;
  }
  .dot {
    width: 26px;
    height: 26px;
    border-radius: 50%;
  }
  .random {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--bg-fill);
    color: var(--text-secondary);
    font-weight: 700;
    font-size: 14px;
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .title {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    font-size: 12.5px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .you {
    font-weight: 400;
    color: var(--text-secondary);
  }
  .tag {
    margin-left: 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-tertiary);
  }
  .seat.open .flag,
  .seat.open .dot {
    opacity: 0.35;
    filter: grayscale(1);
  }
  .seat.open .sub,
  .seat.open .title {
    color: var(--text-tertiary);
  }
  .seat.open:not(:has(.flag, .dot)) .title {
    font-weight: 500;
  }
  .seat.mine {
    background: color-mix(in srgb, var(--c, var(--accent)) 10%, transparent);
  }
  .take {
    padding: 6px 2px;
    border: none;
    background: none;
    color: var(--accent);
    font: 600 13px var(--font);
    cursor: pointer;
  }
  .kick {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
  }
  @media (hover: hover) {
    .kick:hover {
      background: var(--bg-hover);
      color: var(--text);
    }
  }
</style>
