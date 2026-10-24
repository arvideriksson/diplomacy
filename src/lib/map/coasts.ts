// Province-group logic for named coasts, in dSVG-id space ("spa", "spa/nc", "spa/sc").
//
// A named coast is any id containing "/"; its parent is the part before the slash.
// The map normally shows only main (parent) provinces; the individual coasts are
// revealed — and the parent hidden — only while they are the active choice.

const parentOf = (id: string): string => id.split('/')[0]

/**
 * Given every region id on the map and the currently-highlighted ids, decide which
 * regions should be interactive/visible:
 *   - groups with nothing highlighted -> show the main province only
 *   - groups with a highlight -> show only the highlighted members (e.g. the coasts)
 */
export const renderableProvinces = (allIds: string[], highlighted: string[]): string[] => {
  const highlightSet = new Set(highlighted)
  const groups = new Map<string, string[]>()
  for (const id of allIds) {
    const parent = parentOf(id)
    const group = groups.get(parent)
    if (group) group.push(id)
    else groups.set(parent, [id])
  }

  const result: string[] = []
  for (const [parent, members] of groups) {
    const highlightedMembers = members.filter((id) => highlightSet.has(id))
    if (highlightedMembers.length === 0) {
      result.push(parent) // main province only
    } else {
      result.push(...highlightedMembers)
    }
  }
  return result
}
