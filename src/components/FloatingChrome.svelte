<script lang="ts">
  import { useLocation } from 'svelte-routing'
  import HomeBar from './HomeBar.svelte'

  export let onBack: () => void

  const location = useLocation()
</script>

<!-- One top bar on every page outside a game: New game on home, a back button elsewhere. -->
<HomeBar onBack={$location.pathname === '/' ? null : onBack} />
