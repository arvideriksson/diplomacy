// Dev-server endpoint behind the unit anchor editor (/editor): POST /__unit-anchors/<map> with
// { "<dsvg id>": [x, y], … } rewrites those circles in the board's `unit-positions` layer.
// 1900's board is generated, so its anchors are also merged into
// tools/variants/1900/anchors.json, which `npm run map:1900` applies over its own placement.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

const MAPS = new Set(['classical', '1900'])
const ANCHORS_1900 = 'tools/variants/1900/anchors.json'

type Anchors = Record<string, [number, number]>

const round = (n: number) => Math.round(n * 10) / 10
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Rewrite cx/cy of each anchor's circle inside the `unit-positions` layer; returns ids not found. */
export function patchUnitPositions(svg: string, anchors: Anchors): { svg: string; missing: string[] } {
  const start = svg.indexOf('<g id="unit-positions"')
  const end = svg.indexOf('</g>', start)
  if (start < 0 || end < 0) throw new Error('board has no unit-positions layer')
  let layer = svg.slice(start, end)
  const missing: string[] = []
  for (const [id, [x, y]] of Object.entries(anchors)) {
    const circle = new RegExp(`<circle id="${escape(id)}" cx="[^"]*" cy="[^"]*"`)
    if (!circle.test(layer)) {
      missing.push(id)
      continue
    }
    layer = layer.replace(circle, `<circle id="${id}" cx="${round(x)}" cy="${round(y)}"`)
  }
  return { svg: svg.slice(0, start) + layer + svg.slice(end), missing }
}

export function unitAnchorsPlugin(): Plugin {
  return {
    name: 'unit-anchors',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root
      server.middlewares.use('/__unit-anchors/', (req, res) => {
        const map = (req.url ?? '').replace(/^\//, '')
        if (req.method !== 'POST' || !MAPS.has(map)) {
          res.statusCode = 404
          res.end()
          return
        }
        let body = ''
        req.on('data', (chunk) => (body += chunk))
        req.on('end', () => {
          try {
            const anchors = JSON.parse(body) as Anchors
            const file = resolve(root, 'public/maps', `${map}.dsvg`)
            const { svg, missing } = patchUnitPositions(readFileSync(file, 'utf8'), anchors)
            if (missing.length) throw new Error(`unknown anchors: ${missing.join(', ')}`)
            writeFileSync(file, svg)
            if (map === '1900') {
              const path = resolve(root, ANCHORS_1900)
              const saved = JSON.parse(readFileSync(path, 'utf8')) as Anchors
              for (const [id, [x, y]] of Object.entries(anchors)) saved[id] = [round(x), round(y)]
              const sorted = Object.fromEntries(Object.keys(saved).sort().map((id) => [id, saved[id]]))
              writeFileSync(path, JSON.stringify(sorted, null, 2).replace(/\[\s+([^,\]]+),\s+([^\]]+?)\s+\]/g, '[$1, $2]') + '\n')
            }
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ saved: Object.keys(anchors).length }))
          } catch (e) {
            res.statusCode = 400
            res.end(e instanceof Error ? e.message : String(e))
          }
        })
      })
    },
  }
}
