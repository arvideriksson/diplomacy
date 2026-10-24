// One parsed board (and its static-art rasters) per map id for the whole session. The dsvg is
// ~1 MB, so re-fetching and re-parsing it on every map mount (each game opened, the lobby
// demo, …) was wasted work; the static rasters are equally fixed per map.
import { DiplicityMap, type StaticLayers } from './mapRenderer'
import { baseRasterScale, rasterizeSvg, type Raster } from './rasterize'

const renderers = new Map<string, Promise<DiplicityMap>>()
const baseRasters = new Map<string, Promise<{ below: Raster; above: Raster }>>()

/** Memoize an async load per key. A rejected load is evicted, so the next call retries. */
function memoAsync<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let entry = cache.get(key)
  if (!entry) {
    entry = load()
    entry.catch(() => cache.delete(key))
    cache.set(key, entry)
  }
  return entry
}

export function loadMap(mapId: string): Promise<DiplicityMap> {
  return memoAsync(renderers, mapId, async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}maps/${mapId}.dsvg`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return new DiplicityMap(await res.text())
  })
}

/** Full-board bitmaps of the static layers, rendered once per map. */
export function loadBaseRasters(
  mapId: string,
  renderer: DiplicityMap,
  layers: StaticLayers,
): Promise<{ below: Raster; above: Raster }> {
  return memoAsync(baseRasters, mapId, () => {
    const vb = renderer.viewBox
    const scale = baseRasterScale(vb)
    const px = { w: vb.width * scale, h: vb.height * scale }
    return Promise.all([
      rasterizeSvg(layers.below, layers.defs, layers.rootFill, vb, px),
      rasterizeSvg(layers.above, layers.defs, layers.rootFill, vb, px),
    ]).then(([below, above]) => ({ below, above }))
  })
}
