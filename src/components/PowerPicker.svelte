<script lang="ts">
  // Lobby "Choose your power" card: one card per power showing who holds it. Clicking
  // a free power claims it; clicking your own releases it.
  import type { PlayerInfo } from '../lib/game'
  import type { PowerDefinition } from '../lib/mapDefinition'

  export let powers: PowerDefinition[]
  /** power id -> the player holding it */
  export let holderByNation: Record<string, { uid: string; info: PlayerInfo }>
  export let myNation: string | undefined
  export let error: string = ''
  export let onClaim: (nation: string) => void
</script>

<section class="card power-picker">
  <div class="card-head"><h2>Choose your power</h2></div>
  {#if error}<p class="form-error claim-error">{error}</p>{/if}
  <div class="power-grid">
    {#each powers as power (power.id)}
      {@const holder = holderByNation[power.id]}
      {@const mine = myNation === power.id}
      {@const takenByOther = Boolean(holder) && !mine}
      <button
        class="power-card"
        class:mine
        class:taken={takenByOther}
        style={`--power: ${power.color}`}
        disabled={takenByOther}
        on:click={() => onClaim(power.id)}
      >
        <span class="power-name">{power.name}</span>
        <span class="power-holder">
          {#if mine}✓ You
          {:else if holder}{holder.info.display_name ?? 'Player'}
          {:else}Available{/if}
        </span>
      </button>
    {/each}
  </div>
</section>

<style>
  .power-picker {
    margin-bottom: 24px;
  }
  .power-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
  }
  .power-card {
    display: flex;
    flex-direction: column;
    gap: 2px;
    align-items: flex-start;
    text-align: left;
    padding: 10px 12px 10px 14px;
    border: 1px solid var(--border);
    border-left: 4px solid var(--power, var(--border-strong));
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--text);
    cursor: pointer;
    font-family: var(--font);
    transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
  }
  .power-card:hover:not(:disabled) {
    box-shadow: var(--shadow-sm);
  }
  .power-card:disabled {
    cursor: default;
  }
  .power-card.taken {
    opacity: 0.55;
  }
  .power-card.mine {
    border-color: var(--power, var(--accent));
    background: color-mix(in srgb, var(--power, var(--accent)) 12%, var(--bg-card));
  }
  .power-name {
    font-weight: 600;
    font-size: 14px;
  }
  .power-holder {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    margin-top: 2px;
  }

  .claim-error {
    margin: 0 0 12px;
  }
</style>
