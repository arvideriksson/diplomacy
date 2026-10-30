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
  import type { SandboxContent } from '../lib/share/timeline'
  import { immersive } from '../lib/layout'

  export let sandboxId: string
  export let sharedPayload: string | undefined = undefined
  export let onBack: () => void = () => {}

  // Sandboxes claim the full viewport (no header), like the active board.
  immersive.set(true)
  onDestroy(() => immersive.set(false))

  let shareError = ''
  let shared: SandboxContent | undefined
  $: isShare = sharedPayload !== undefined
  onMount(async () => {
    if (sharedPayload === undefined) return
    try {
      shared = await decodeSandbox(sharedPayload)
    } catch {
      shareError = 'This shared sandbox link is invalid or incompatible.'
    }
  })

  function saveShared() {
    if (!shared) return
    const saved = importSandbox(shared)
    navigate(`/sandbox/${saved.id}`, { replace: true })
  }

  function stepShared(direction: number) {
    if (!shared) return
    const cursor = Math.max(0, Math.min(shared.frames.length - 1, shared.cursor + direction))
    shared = { ...shared, cursor }
  }

  $: sb = $sandboxes.find((s) => s.id === sandboxId)
  $: if (sb?.origin) navigate(`/game/${sb.origin.gameId}?sandbox=${sb.id}`, { replace: true })
</script>

{#if isShare}
  {#if shared}
    <div class="sandbox-stage">
      <SandboxBoard sandbox={{ ...shared, id: '', createdAt: '' }} map={getMap(shared.mapId)} onExit={onBack} onDeleted={onBack} preview onPreviewStep={stepShared}>
        <div slot="preview-banner" class="glass shared-bar">
          <strong>Preview</strong>
          <button class="btn btn-primary" on:click={saveShared} aria-label="Save sandbox" title="Save a copy to edit">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M5 3h12l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
              <path d="M7 3v6h9V3M7 21v-8h10v8" />
            </svg>
            Save
          </button>
        </div>
      </SandboxBoard>
    </div>
  {:else}
    <StatusPage loading={!shareError} message={shareError} actionLabel={shareError ? 'Back' : ''} onAction={onBack} />
  {/if}
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
  .shared-bar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 2px 2px 2px 14px;
    border-radius: 999px;
    color: var(--text);
    font-size: 13px;
    white-space: nowrap;
  }
  .shared-bar .btn {
    border-radius: 999px;
    min-height: 34px;
    padding: 4px 12px;
    font-size: 12px;
  }
</style>
