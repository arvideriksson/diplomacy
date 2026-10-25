<script lang="ts">
  // Standalone sandbox route (/sandbox/:id). A sandbox copied from a game lives inside
  // that game's view instead, so this forwards there.
  import { onDestroy } from 'svelte'
  import { navigate } from 'svelte-routing'
  import { getMap } from '../lib/maps'
  import SandboxBoard from './SandboxBoard.svelte'
  import StatusPage from './StatusPage.svelte'
  import { sandboxes } from '../lib/sandbox'
  import { immersive } from '../lib/layout'

  export let sandboxId: string
  export let onBack: () => void = () => {}

  // Sandboxes claim the full viewport (no header), like the active board.
  immersive.set(true)
  onDestroy(() => immersive.set(false))

  $: sb = $sandboxes.find((s) => s.id === sandboxId)
  $: if (sb?.origin) navigate(`/game/${sb.origin.gameId}?sandbox=${sb.id}`, { replace: true })
</script>

{#if !sb}
  <StatusPage message="This sandbox no longer exists." actionLabel="Back" onAction={onBack} />
{:else if !sb.origin}
  <div class="sandbox-stage">
    <SandboxBoard sandbox={sb} map={getMap(sb.mapId)} onExit={onBack} onDeleted={onBack} />
  </div>
{/if}

<style>
  .sandbox-stage {
    position: relative;
    height: 100%;
  }
</style>
