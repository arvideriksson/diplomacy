<script lang="ts">
  // Lobby "Players" card: seated players (tinted by chosen nation, host badged, with a
  // leave/remove action) followed by an empty slot per open seat.
  import { fly } from 'svelte/transition'
  import type { PlayerInfo } from '../lib/game'
  import type { PowerDefinition } from '../lib/mapDefinition'
  import { powerName, powerColor } from '../lib/powers'
  import Avatar from './Avatar.svelte'
  import Icon from './Icon.svelte'

  export let players: Record<string, PlayerInfo>
  export let powers: PowerDefinition[]
  /** One seat per power. */
  export let maxPlayers: number
  /** The host's user id. */
  export let hostId: string
  /** The viewer's user id. */
  export let userId: string | undefined
  /** The viewer is the host (may remove others; can't leave their own lobby). */
  export let isAdmin: boolean
  export let onLeave: () => void
  export let onKick: (playerId: string) => void

  $: playerCount = Object.keys(players).length
</script>

<section class="card">
  <div class="card-head">
    <Icon name="users" />
    <h2>Players</h2>
    <span class="player-counter">{playerCount}/{maxPlayers}</span>
  </div>

  <div class="player-list">
    {#each Object.entries(players) as [uid, player] (uid)}
      {@const info = player}
      <div
        class="player-row"
        class:has-nation={info.nation}
        style={info.nation ? `--power: ${powerColor(powers, info.nation)}` : ''}
        transition:fly={{ y: 10, duration: 200 }}
      >
        <Avatar src={info.avatar_url} name={info.display_name} />
        <div class="player-info">
          <span class="player-name">
            {info.display_name ?? 'Anonymous'}
            {#if uid === hostId}
              <span class="badge badge-caps badge-amber host-badge">Host</span>
            {/if}
          </span>
          {#if info.nation}
            <span class="player-nation">{powerName(powers, info.nation)}</span>
          {/if}
        </div>
        {#if uid === userId && !isAdmin}
          <button class="leave-btn" on:click={onLeave} title="Leave game">
            <Icon name="logout" size={14} />
          </button>
        {:else if isAdmin && uid !== userId}
          <button class="kick-btn" on:click={() => onKick(uid)} title="Remove player">
            <Icon name="close" size={14} />
          </button>
        {/if}
      </div>
    {/each}

    {#each { length: Math.max(0, maxPlayers - playerCount) } as _}
      <div class="player-row empty-slot">
        <div class="empty-avatar">
          <Icon name="user" size={16} strokeWidth={1.5} />
        </div>
        <span class="empty-label">Waiting for player...</span>
      </div>
    {/each}
  </div>
</section>

<style>
  .player-counter {
    margin-left: auto;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-tertiary);
    background: var(--bg-elevated);
    padding: 2px 8px;
    border-radius: var(--radius-full);
  }

  .player-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .player-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    transition: background 0.12s;
  }

  .player-row:not(.empty-slot):hover {
    background: var(--bg-hover);
  }

  /* Tint a seated player's row in their chosen nation's color. */
  .player-row.has-nation,
  .player-row.has-nation:not(.empty-slot):hover {
    background: color-mix(in srgb, var(--power) 14%, var(--bg-card));
    box-shadow: inset 3px 0 0 var(--power);
  }

  .empty-avatar {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-elevated);
    border: 1px dashed var(--border);
    color: var(--text-tertiary);
  }

  .player-info {
    flex: 1;
    min-width: 0;
  }

  .player-name {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    font-weight: 500;
    color: var(--text);
  }

  .host-badge {
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
  }

  .player-nation {
    display: inline-block;
    margin-top: 2px;
    font-size: 11px;
    font-weight: 600;
    padding: 1px 8px;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--power, var(--border-strong)) 22%, transparent);
    color: var(--text-secondary);
  }

  .empty-label {
    font-size: 13px;
    color: var(--text-tertiary);
    font-style: italic;
  }

  .leave-btn, .kick-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 5px 8px;
    cursor: pointer;
    color: var(--text-tertiary);
    transition: all 0.12s;
    display: flex;
    align-items: center;
    font-family: var(--font);
  }

  .leave-btn:hover, .kick-btn:hover {
    color: var(--red);
    border-color: var(--red);
    background: var(--red-subtle);
  }
</style>
