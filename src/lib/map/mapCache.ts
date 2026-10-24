// One parsed board (and its static-art rasters) per map id for the whole session. The dsvg is
// ~1 MB, so re-fetching and re-parsing it on every map mount (each game opened, the lobby
// demo, …) was wasted work; the static rasters are equally fixed per map.
import { DiplicityMap, type StaticLayers } from './mapRenderer'
import { baseRasterScale, rasterizeSvg, type Raster } from './rasterize'

const renderers = new Map<string, Promise<DiplicityMap>>()
const baseRasters = new Map<string, Promise<{ below: Raster; above: Raster }>>()

export function loadMap(mapId: string): Promise<DiplicityMap> {
  let entry = renderers.get(mapId)
  if (!entry) {
    entry = (async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}maps/${mapId}.dsvg`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return new DiplicityMap(await res.text())
    })()
    // A failed load is not cached, so the next mount retries.
    entry.catch(() => renderers.delete(mapId))
    renderers.set(mapId, entry)
  }
  return entry
}

/** Full-board bitmaps of the static layers, rendered once per map. */
export function loadBaseRasters(
  mapId: string,
  renderer: DiplicityMap,
  layers: StaticLayers,
): Promise<{ below: Raster; above: Raster }> {
  let entry = baseRasters.get(mapId)
  if (!entry) {
    const vb = renderer.viewBox
    const scale = baseRasterScale(vb)
    const px = { w: vb.width * scale, h: vb.height * scale }
    entry = Promise.all([
      rasterizeSvg(layers.below, layers.defs, layers.rootFill, vb, px),
      rasterizeSvg(layers.above, layers.defs, layers.rootFill, vb, px),
    ]).then(([below, above]) => ({ below, above }))
    entry.catch(() => baseRasters.delete(mapId))
    baseRasters.set(mapId, entry)
  }
  return entry
}
