// Pure edits behind the layout editor's saves (scripts/mapLayoutPlugin.ts): rewrite unit
// anchors, supply-center points and label transforms in a board's dSVG text, and merge the
// same edits into a generated board's placements.json.
export type Point = [number, number]
export type Layout = {
  units?: Record<string, Point>
  centers?: Record<string, Point>
  labels?: Record<string, { at: Point; angle: number }>
}

const round = (n: number) => Math.round(n * 10) / 10
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The [start, end) of a layer's markup: the `<g id="…">` through its matching `</g>`. */
function layerRange(svg: string, id: string): [number, number] {
  const at = svg.indexOf(`id="${id}"`)
  if (at < 0) throw new Error(`board has no ${id} layer`)
  const open = svg.lastIndexOf('<g', at)
  let depth = 0
  for (const m of svg.slice(open).matchAll(/<(\/?)g\b[^>]*?(\/?)>/g)) {
    if (m[2]) continue
    depth += m[1] ? -1 : 1
    if (!depth) return [open, open + m.index + m[0].length]
  }
  throw new Error(`unclosed ${id} layer`)
}

/** Rewrite cx/cy of each point's circle inside layer `layerId`; returns ids not found. */
export function patchPoints(svg: string, layerId: string, points: Record<string, Point>): { svg: string; missing: string[] } {
  const [start, end] = layerRange(svg, layerId)
  let layer = svg.slice(start, end)
  const missing: string[] = []
  for (const [id, [x, y]] of Object.entries(points)) {
    const circle = new RegExp(`<circle id="${escape(id)}" cx="[^"]*" cy="[^"]*"`)
    if (!circle.test(layer)) {
      missing.push(id)
      continue
    }
    layer = layer.replace(circle, `<circle id="${id}" cx="${round(x)}" cy="${round(y)}"`)
  }
  return { svg: svg.slice(0, start) + layer + svg.slice(end), missing }
}

/** Rewrite the transform of each label group (`<g id="name:…" transform="…">`); returns ids not found. */
export function patchLabels(svg: string, labels: NonNullable<Layout['labels']>): { svg: string; missing: string[] } {
  const [start, end] = layerRange(svg, 'province-names')
  let layer = svg.slice(start, end)
  const missing: string[] = []
  for (const [id, { at: [x, y], angle }] of Object.entries(labels)) {
    const group = new RegExp(`<g id="${escape(id)}" transform="[^"]*"`)
    if (!group.test(layer)) {
      missing.push(id)
      continue
    }
    const a = round(angle)
    layer = layer.replace(group, `<g id="${id}" transform="translate(${round(x)} ${round(y)})${a ? ` rotate(${a})` : ''}"`)
  }
  return { svg: svg.slice(0, start) + layer + svg.slice(end), missing }
}

export function applyLayout(svg: string, layout: Layout): string {
  const missing: string[] = []
  const step = (r: { svg: string; missing: string[] }) => (missing.push(...r.missing), r.svg)
  if (layout.units) svg = step(patchPoints(svg, 'unit-positions', layout.units))
  if (layout.centers) svg = step(patchPoints(svg, 'supply-centers', layout.centers))
  if (layout.labels) svg = step(patchLabels(svg, layout.labels))
  if (missing.length) throw new Error(`unknown ids: ${missing.join(', ')}`)
  return svg
}

const sortKeys = <T>(o: Record<string, T>) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]))

/** Merge `layout` into a placements file's JSON text. */
export function mergePlacements(json: string, layout: Layout): string {
  const saved = { units: {}, centers: {}, labels: {}, ...JSON.parse(json) } as Required<Layout>
  for (const [id, [x, y]] of Object.entries(layout.units ?? {})) saved.units[id] = [round(x), round(y)]
  for (const [id, [x, y]] of Object.entries(layout.centers ?? {})) saved.centers[id] = [round(x), round(y)]
  for (const [id, { at: [x, y], angle }] of Object.entries(layout.labels ?? {})) saved.labels[id] = { at: [round(x), round(y)], angle: round(angle) }
  const out = { units: sortKeys(saved.units), centers: sortKeys(saved.centers), labels: sortKeys(saved.labels) }
  return JSON.stringify(out, null, 2).replace(/\[\s+([^,\]]+),\s+([^\]]+?)\s+\]/g, '[$1, $2]') + '\n'
}
