<script lang="ts">
  import { onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import { Router, Route, navigate } from 'svelte-routing'
  import { initAuth, isAuthenticated, isSiteAdmin, needsDisplayName } from './lib/auth'
  import { fetchGames } from './lib/game'
  import { immersive } from './lib/layout'
  import LoginButton from './components/LoginButton.svelte'
  import FloatingChrome from './components/FloatingChrome.svelte'
  import ArtColumns from './components/ArtColumns.svelte'
  import GameList from './components/GameList.svelte'
  import GameRoute from './components/GameRoute.svelte'
  import JoinRoute from './components/JoinRoute.svelte'
  import AdminPanel from './components/AdminPanel.svelte'
  import NameDialog from './components/NameDialog.svelte'
  import SandboxView from './components/SandboxView.svelte'
  import BrandMark from './components/BrandMark.svelte'
  import { createSandbox } from './lib/sandbox'
  import { supabaseConfigured } from './lib/supabase'
  import { initPush } from './lib/push'

  // Dev-only test-seat switcher; a dynamic import so production builds never ship it.
  const devSeats = import.meta.env.DEV && supabaseConfigured
    ? import('./components/DevSeatSwitcher.svelte')
    : null
  // Layout editor (units, supply centers, labels): local dev server only (it saves through it), never against live.
  const anchorEditor = import.meta.env.DEV && import.meta.env.VITE_BACKEND === 'local' ? import('./components/MapLayoutEditor.svelte') : null

  let ready = false

  function openSandbox(id: string) {
    navigate(`/sandbox/${id}`)
  }

  function newSandbox(name: string, mapId: string) {
    openSandbox(createSandbox(name, mapId).id)
  }


  onMount(async () => {
    await initAuth()
    ready = true
  })

  function handleSelectGame(game: { id: string }) {
    navigate(`/game/${game.id}`)
  }

  function handleBackToList() {
    navigate('/')
    fetchGames().catch(() => {})
  }

  $: if ($isAuthenticated && ready) {
    fetchGames().catch(() => {})
    initPush().catch(() => {})
  }
</script>

{#if !ready}
  <div class="loading">
    <div class="spinner"></div>
  </div>
{:else}
<Router>
  <!-- No title bar: page chrome floats over the content. Immersive views (game, sandbox) bring their own. -->
  {#if !$immersive && $isAuthenticated}
    <FloatingChrome onBack={handleBackToList} />
    <ArtColumns />
  {/if}

  <main class:immersive={$immersive}>
    <!-- Sandboxes are local-only (browser storage + the in-browser engine): no sign-in needed. -->
    <Route path="/sandbox/:id" let:params>
      <SandboxView sandboxId={params.id} onBack={handleBackToList} />
    </Route>
    {#if anchorEditor}
      <Route path="/editor">
        {#await anchorEditor then { default: MapLayoutEditor }}
          <MapLayoutEditor />
        {/await}
      </Route>
    {/if}
    {#if !$isAuthenticated && !location.pathname.startsWith('/sandbox/') && !location.pathname.startsWith('/editor')}
      <!-- Sign-in: the Congress of Berlin (Anton von Werner, 1881; public domain) edge to
           edge, the mark and the sign-in button straight on top. -->
      <div class="auth-page" in:fade={{ duration: 200 }}>
        <img class="auth-painting" src="/art/congress-of-berlin.webp" alt="" />
        <div class="auth-card">
          <div class="auth-brand">
            <BrandMark size={52} />
            <span class="auth-word">Diplomacy</span>
          </div>
          <div class="login-container">
            <LoginButton />
          </div>
        </div>
      </div>
    {:else}
      <Route path="/game/:id" let:params>
        <GameRoute id={params.id} />
      </Route>
      <Route path="/join/:id" let:params>
        <JoinRoute id={params.id} />
      </Route>
      <Route path="/">
        <div class="list-view">
          <GameList
            onSelectGame={handleSelectGame}
            onOpenSandbox={openSandbox}
            onCreateSandbox={newSandbox}
          />
          {#if $isSiteAdmin}
            <AdminPanel />
          {/if}
        </div>
      </Route>
    {/if}
  </main>
  {#if $needsDisplayName}
    <NameDialog firstTime />
  {/if}
  {#if devSeats}
    {#await devSeats then { default: DevSeatSwitcher }}
      <DevSeatSwitcher />
    {/await}
  {/if}
</Router>
{/if}

<style>
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
  }

  main {
    flex: 1;
    max-width: 960px;
    margin: 0 auto;
    padding: 32px 24px 64px;
    width: 100%;
  }

  /* The top bar is in flow above: nothing to clear. */
  :global(.home-bar) ~ main {
    padding-top: 28px;
  }
  @media (max-width: 600px) {
    :global(.home-bar) ~ main {
      padding-top: 20px;
    }
  }

  /* Immersive in-game / sandbox: no floating chrome, so the board claims the
     full viewport. flex:none + a fixed height stops the item from growing to the
     map's intrinsic SVG height (which would push the overlays off-screen). */
  main.immersive {
    flex: none;
    max-width: none;
    padding: 0;
    height: 100dvh;
    min-height: 0;
    overflow: hidden;
  }

  /* Full-screen, over everything: the painting, darkened softly toward the card. */
  .auth-page {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: grid;
    place-items: center;
    padding: 24px;
    background: #000;
  }

  .auth-painting {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .auth-page::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 1;
    background: radial-gradient(ellipse at 50% 52%, rgba(10, 8, 6, 0.55) 0%, rgba(10, 8, 6, 0.25) 40%, rgba(10, 8, 6, 0) 72%);
  }

  /* No card: the mark and button sit on the painting, lifted by soft shadows. */
  .auth-card {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 22px;
    padding: 34px 40px 30px;
  }

  .auth-brand :global(img) {
    filter: drop-shadow(0 4px 14px rgba(0, 0, 0, 0.45));
  }

  .auth-brand {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .auth-word {
    padding-left: 4.2px;
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 4.2px;
    text-transform: uppercase;
    color: #fff;
    text-shadow: 0 1px 12px rgba(0, 0, 0, 0.6);
  }

  .login-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  /* The Google button stays white on the painting in either theme. */
  .login-container :global(.login-btn) {
    background: #fff;
    color: #1a1a1a;
    border-color: rgba(0, 0, 0, 0.15);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  }

  @media (prefers-color-scheme: dark) {
    .auth-painting {
      filter: brightness(0.82);
    }
  }

  /* Phones: 16px gutters, the floating back button / avatar cleared, and room at the
     bottom past the home indicator. */
  @media (max-width: 600px) {
    main {
      padding: calc(68px + env(safe-area-inset-top)) 16px calc(40px + env(safe-area-inset-bottom));
    }

    /* Phones: the painting crops to the handshake; the card sits low, clear of the
       faces and within thumb reach. */
    .auth-page {
      place-items: end center;
      padding: 24px 20px calc(56px + env(safe-area-inset-bottom));
    }

    .auth-painting {
      object-position: 74% 50%;
    }

    .auth-page::before {
      background: linear-gradient(180deg, rgba(10, 8, 6, 0) 40%, rgba(10, 8, 6, 0.6) 100%);
    }

    .auth-card {
      width: 100%;
      max-width: 330px;
      padding: 30px 0 26px;
    }

    .login-container,
    .login-container :global(.login-btn) {
      width: 100%;
    }

    .login-container :global(.login-btn) {
      justify-content: center;
    }
  }
</style>
