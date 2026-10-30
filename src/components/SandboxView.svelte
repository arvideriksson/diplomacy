<script lang="ts">
  // Standalone sandbox route (/sandbox/:id). A sandbox copied from a game lives inside
  // that game's view instead, so this forwards there.
  import { onDestroy, onMount } from 'svelte'
  import { navigate } from 'svelte-routing'
  import { getMap } from '../lib/maps'
  import SandboxBoard from './SandboxBoard.svelte'
  import StatusPage from './StatusPage.svelte'
  import { sandboxes, importSandbox } from '../lib/sandbox'
  import { decodeSandbox } from '../lib/share'
  import { immersive } from '../lib/layout'

  export let sandboxId: string
  export let onBack: () => void = () => {}

  // Sandboxes claim the full viewport (no header), like the active board.
  immersive.set(true)
  onDestroy(() => immersive.set(false))

  let shareError = ''
  $: isShare = !$sandboxes.some(s => s.id === sandboxId) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(sandboxId)
  onMount(async () => {
    if (!isShare) return
    try {
      const imported = importSandbox(await decodeSandbox(sandboxId))
      navigate(`/sandbox/${imported.id}`, { replace: true })
    } catch {
      shareError = 'This shared sandbox link is invalid or incompatible.'
    }
  })

  $: sb = $sandboxes.find((s) => s.id === sandboxId)
  $: if (sb?.origin) navigate(`/game/${sb.origin.gameId}?sandbox=${sb.id}`, { replace: true })
</script>

{#if isShare}
  <StatusPage loading={!shareError} message={shareError} actionLabel={shareError ? 'Back' : ''} onAction={onBack} />
{:else if !sb}
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
