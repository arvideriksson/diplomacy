// Shared parsing for the SVG/XML sources.

/** The attributes of one start tag's attribute text, as a name → value object. */
export const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]))

/** The adjacency XML refers to these two seas by their judge aliases. */
export const SOURCE_ALIASES = { mao: 'mid', nao: 'nat' }

/** The source province an adjacency ref (e.g. `spa-nc`, `mao`) points at. */
export const refProvince = (ref) => {
  const id = ref.split('-')[0]
  return SOURCE_ALIASES[id] ?? id
}
