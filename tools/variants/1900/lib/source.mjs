// Helpers for reading the variant's source XML (adjacency and rules files).

export const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]))

// The adjacency XML refers to these two seas by their judge aliases.
const ALIASES = { mao: 'mid', nao: 'nat' }

/** The province an adjacency ref points at: coast suffix dropped, judge alias resolved. */
export const refTarget = (ref) => { const id = ref.split('-')[0]; return ALIASES[id] ?? id }
