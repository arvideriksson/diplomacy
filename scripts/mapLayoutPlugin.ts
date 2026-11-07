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

/**
 * Boards generated FROM another board: 1900 inherits classical's kept labels, unit anchors
 * and geometry (tools/variants/1900/build.mjs reads public/maps/classical.dsvg). An edit to
 * the source board changes the generated one on its next build — CI's "generated boards"
 * check fails until it is rebuilt — so a save says which builds to rerun.
 */
const DERIVED: Record<string, { board: string; command: string }[]> = {
  classical: [{ board: '1900', command: 'npm run map:1900' }],
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
            const rebuild = DERIVED[map] ?? []
            for (const d of rebuild) {
              server.config.logger.warn(`[map-layout] ${map}.dsvg changed; ${d.board} is built from it — run \`${d.command}\``)
            }
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ saved, rebuild: rebuild.map((d) => d.command) }))
          } catch (e) {
            res.statusCode = 400
            res.end(e instanceof Error ? e.message : String(e))
          }
        })
      })
    },
  }
}
