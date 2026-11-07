// Dev-server endpoint behind the layout editor (/editor): POST /__map-layout/<map> with
// { units?: { id: [x, y] }, centers?: { id: [x, y] }, labels?: { id: { at: [x, y], angle } } }
// (dSVG ids) rewrites those unit anchors, supply-center points and label transforms in
// public/maps/<map>.dsvg. Generated boards also merge them into their variant's
// placements.json, which the generator applies last, so a rebuild keeps them.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { applyLayout, mergePlacements, type Layout } from '../src/lib/map/layoutPatch.ts'

/** Board id -> its generator's placements file (boards without one are edited in place). */
const PLACEMENTS: Record<string, string | null> = {
  classical: null,
  '1900': 'tools/variants/1900/placements.json',
  era: 'tools/variants/era/placements.json',
}

export function mapLayoutPlugin(): Plugin {
  return {
    name: 'map-layout',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root
      server.middlewares.use('/__map-layout/', (req, res) => {
        const map = (req.url ?? '').replace(/^\//, '')
        if (req.method !== 'POST' || !(map in PLACEMENTS)) {
          res.statusCode = 404
          res.end()
          return
        }
        let body = ''
        req.on('data', (chunk) => (body += chunk))
        req.on('end', () => {
          try {
            const layout = JSON.parse(body) as Layout
            const file = resolve(root, 'public/maps', `${map}.dsvg`)
            writeFileSync(file, applyLayout(readFileSync(file, 'utf8'), layout))
            const placements = PLACEMENTS[map]
            if (placements) {
              const path = resolve(root, placements)
              writeFileSync(path, mergePlacements(readFileSync(path, 'utf8'), layout))
            }
            const saved = Object.values(layout).reduce((n, group) => n + Object.keys(group ?? {}).length, 0)
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ saved }))
          } catch (e) {
            res.statusCode = 400
            res.end(e instanceof Error ? e.message : String(e))
          }
        })
      })
    },
  }
}
