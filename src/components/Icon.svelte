<script lang="ts" context="module">
  // Stroke icons repeated across the UI (24×24, currentColor). Single-use glyphs stay
  // inline where they're used.
  const ICONS = {
    gear:
      '<circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />',
    close: '<line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />',
    back: '<path d="M15 18l-6-6 6-6" />',
    'chevron-right': '<path d="M9 18l6-6-6-6" />',
    'chevron-down': '<path d="M6 9l6 6 6-6" />',
    users:
      '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />',
    // Material Design Icons "location-exit" (Apache 2.0); a filled glyph, hence the fill.
    exit: '<path fill="currentColor" stroke="none" d="M22 12L18 8V11H10V13H18V16M20 18A10 10 0 1 1 20 6H17.27A8 8 0 1 0 17.27 18Z" />',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" />',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />',
    check: '<path d="M20 6L9 17l-5-5" />',
    // The game sections (phone tab bar, and the map buttons for hidden sidebars).
    press: '<path d="M4 20h14a2 2 0 0 0 2-2V4H7v14a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-8h4" /><path d="M11 8h5M11 12h5M11 16h3" />',
    map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" /><path d="M9 4v14M15 6v14" />',
    orders: '<circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5" />',
    'panel-left': '<rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" />',
    'panel-right': '<rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" />',
  } as const

  export type IconName = keyof typeof ICONS
</script>

<script lang="ts">
  export let name: IconName
  export let size = 18
  export let strokeWidth: number | string = 2
  /** Round line caps/joins — used by the back chevrons. */
  export let round = false
</script>

<svg
  viewBox="0 0 24 24"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap={round ? 'round' : undefined}
  stroke-linejoin={round ? 'round' : undefined}
  aria-hidden="true"
  {...$$restProps}
>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- static, module-defined markup -->
  {@html ICONS[name]}
</svg>
