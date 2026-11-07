// Every board stores its movable layout the same way: unit anchors and supply centers as
// points in hidden layers, and each name / coast mark / note as one placed group in
// province-names. The layout editor (/editor) and scripts/mapLayoutPlugin.ts rely on it.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { maps } from '../../maps'
import { toDsvgId } from '../idMap'
import { applyLayout, mergePlacements } from '../layoutPatch'

const board = (id: string) => readFileSync(new URL(`../../../../public/maps/${id}.dsvg`, import.meta.url), 'utf8')
/** A layer's markup up to the next layer (enough for the flat point and path layers). */
const layer = (svg: string, id: string) => {
  const at = svg.indexOf(`id="${id}"`)
  return at < 0 ? '' : svg.slice(at, svg.indexOf('</g>', at))
}
const ids = (markup: string, re: RegExp) => [...markup.matchAll(re)].map((m) => m[1])

describe.each(['classical', '1900', 'era'])('%s board layout', (mapId) => {
  const svg = board(mapId)
  const mapDef = maps[mapId]
  const provinces = new Set(ids(layer(svg, 'provinces'), /<path\b[^>]*\bid="([^"]+)"/g))
  const coasts = new Set(ids(layer(svg, 'named-coasts'), /<path\b[^>]*\bid="([^"]+)"/g))

  it('has a supply-center point for exactly the map definition’s centers', () => {
    const start = svg.indexOf('id="supply-centers"')
    expect(start).toBeGreaterThan(0)
    const points = ids(svg.slice(start, svg.indexOf('</g>', start)), /<circle id="([^"]+)" cx="[-\d.]+" cy="[-\d.]+"/g)
    const expected = Object.entries(mapDef.territories).filter(([, t]) => t.supplyCenter).map(([id]) => toDsvgId(id))
    expect(points.sort()).toEqual(expected.sort())
  })

  it('draws no supply-center bullseyes into its artwork', () => {
    expect(svg).not.toMatch(/<circle[^>]*r="7\.9344115"/)
  })

  it('tags every label with a province, coast or note id', () => {
    const start = svg.indexOf('id="province-names"')
    const labels = ids(svg.slice(start), /<g id="([^"]+)" transform="translate\([-\d.]+ [-\d.]+\)(?: rotate\([-\d.]+\))?">/g)
    expect(labels.length).toBeGreaterThan(30)
    expect(new Set(labels).size).toBe(labels.length)
    for (const id of labels) {
      const [, kind, target] = id.match(/^(name|coast|note):([^~]+)(~\d+)?$/) ?? []
      expect(kind, id).toBeTruthy()
      if (kind === 'name') expect(provinces.has(target), id).toBe(true)
      if (kind === 'coast') expect(coasts.has(target), id).toBe(true)
    }
  })
})

describe('applyLayout', () => {
  const svg = `<svg><g id="unit-positions" style="display:none"><circle id="boh" cx="1" cy="2"/></g><g id="supply-centers" style="display:none"><circle id="vie" cx="3" cy="4"/></g><g id="province-names"><g id="name:boh" transform="translate(5 6) rotate(10)"><text>Bohemia</text></g></g></svg>`

  it('rewrites unit anchors, supply centers and label transforms', () => {
    const out = applyLayout(svg, { units: { boh: [10.04, 20] }, centers: { vie: [30, 40.06] }, labels: { 'name:boh': { at: [50, 60], angle: 0 } } })
    expect(out).toContain('<circle id="boh" cx="10" cy="20"/>')
    expect(out).toContain('<circle id="vie" cx="30" cy="40.1"/>')
    expect(out).toContain('<g id="name:boh" transform="translate(50 60)"><text>Bohemia</text></g>')
  })

  it('rejects ids the board does not have', () => {
    expect(() => applyLayout(svg, { labels: { 'name:xxx': { at: [0, 0], angle: 0 } } })).toThrow(/name:xxx/)
  })

  it('merges into a placements file, sorted', () => {
    const json = mergePlacements('{"units":{"z":[1, 1]}}', { units: { a: [2, 2] }, labels: { 'name:a': { at: [1, 2], angle: 5 } } })
    expect(JSON.parse(json)).toEqual({ units: { a: [2, 2], z: [1, 1] }, centers: {}, labels: { 'name:a': { at: [1, 2], angle: 5 } } })
  })
})
