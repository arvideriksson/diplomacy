<script lang="ts">
  import { onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import { Router, Route, navigate } from 'svelte-routing'
  import { initAuth, isAuthenticated, isSiteAdmin } from './lib/auth'
  import { fetchGames } from './lib/game'
  import type { GameState } from './lib/game'
  import { immersive } from './lib/layout'
  import LoginButton from './components/LoginButton.svelte'
  import FloatingChrome from './components/FloatingChrome.svelte'
  import GameList from './components/GameList.svelte'
  import DiplomacyMap from './components/DiplomacyMap.svelte'
  import GameRoute from './components/GameRoute.svelte'
  import JoinRoute from './components/JoinRoute.svelte'
  import AdminPanel from './components/AdminPanel.svelte'
  import SandboxView from './components/SandboxView.svelte'
  import { classicalMap } from './lib/maps/classical'
  import { initialBoard } from './lib/adjudicator'
  import { createSandbox } from './lib/sandbox'
  import { supabaseConfigured } from './lib/supabase'

  // Dev-only test-seat switcher; a dynamic import so production builds never ship it.
  const devSeats = import.meta.env.DEV && supabaseConfigured
    ? import('./components/DevSeatSwitcher.svelte')
    : null

  let ready = false

  function openSandbox(id: string) {
    navigate(`/sandbox/${id}`)
  }

  function newSandbox(name: string, mapId: string) {
    openSandbox(createSandbox(name, mapId).id)
  }

  // Opening position for the sign-in page: starting units, home centers tinted by owner.
  const demoBoard = initialBoard(classicalMap)

  onMount(async () => {
    await initAuth()
    ready = true
  })

  function handleSelectGame(game: GameState) {
    navigate(`/game/${game.id}`)
  }

  function handleBackToList() {
    navigate('/')
    fetchGames().catch(() => {})
  }

  $: if ($isAuthenticated && ready) {
    fetchGames().catch(() => {})
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
  {/if}

  <main class:immersive={$immersive}>
    <!-- Sandboxes are local-only (browser storage + the in-browser engine): no sign-in needed. -->
    <Route path="/sandbox/:id" let:params>
      <SandboxView sandboxId={params.id} onBack={handleBackToList} />
    </Route>
    {#if !$isAuthenticated && !location.pathname.startsWith('/sandbox/')}
      <div class="auth-page" in:fade={{ duration: 200 }}>
        <div class="auth-card">
          <div class="auth-hero">
            <h1>Diplomacy</h1>
          </div>
          <DiplomacyMap mapDef={classicalMap} units={demoBoard.units} ownership={demoBoard.supplyCenters} interactive={false} />
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
          {#if $isSiteAdmin}
            <AdminPanel />
          {/if}
          <GameList
            onSelectGame={handleSelectGame}
            onOpenSandbox={openSandbox}
            onCreateSandbox={newSandbox}
          />
        </div>
      </Route>
    {/if}
  </main>
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

  /* Once the content column reaches the floating back button and avatar, clear them. */
  @media (max-width: 1060px) {
    main {
      padding-top: 72px;
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

  .auth-page {
    display: flex;
    justify-content: center;
    padding-top: 40px;
  }

  .auth-card {
    text-align: center;
    max-width: 680px;
    width: 100%;
  }

  .auth-hero h1 {
    font-size: 44px;
    font-weight: 700;
    margin: 0 0 32px;
    letter-spacing: -1.5px;
    color: var(--text);
  }

  .login-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    margin-top: 36px;
  }
</style>
