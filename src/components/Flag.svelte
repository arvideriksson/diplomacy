<script lang="ts">
  // A nation's flag roundel, or a dot in the power's colour when the map has no flag for
  // it. The nation may be a power id or name in any case (lib/powers). Without `size`
  // the parent sizes it (via `class` and a :global rule).
  import { flagUrl } from '../lib/flags'
  import { powerInfo } from '../lib/powers'
  import type { MapDefinition, PowerDefinition } from '../lib/mapDefinition'

  /** The map, or its power list, the nation belongs to. */
  export let powers: readonly PowerDefinition[] | Pick<MapDefinition, 'powers'>
  export let nation: string
  export let size: number | undefined = undefined
  /** Accessible name; decorative when empty. */
  export let alt = ''
  export let title: string | undefined = undefined
  let className = ''
  export { className as class }

  $: info = powerInfo(powers, nation)
  $: src = flagUrl[info.flag]
</script>

{#if src}
  <img class="flag {className}" {src} {alt} {title} width={size} height={size} />
{:else}
  <span
    class="flag dot {className}"
    style:background={info.color}
    style:width={size ? `${size}px` : undefined}
    style:height={size ? `${size}px` : undefined}
    role={alt ? 'img' : undefined}
    aria-label={alt || undefined}
    aria-hidden={alt ? undefined : 'true'}
    {title}
  ></span>
{/if}

<style>
  .flag {
    display: block;
    flex: none;
  }
  .dot {
    border-radius: 50%;
  }
</style>
