// Tiny dependency-free local server for the map editor.
//   node tools/map-editor/server.mjs   →  http://localhost:5210
// Serves the editor + units.json, and persists grouped provinces to provinces.json.
import http from 'node:http'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'

const DIR = new URL('.', import.meta.url)
const PROV = new URL('./provinces.json', DIR)
const PORT = 5210

const send = (res, code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body) }
const loadProvs = () => (existsSync(PROV) ? JSON.parse(readFileSync(PROV, 'utf8')) : [])

const server = http.createServer((req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) return send(res, 200, 'text/html; charset=utf-8', readFileSync(new URL('./editor.html', DIR)))
    if (req.method === 'GET' && req.url === '/units.json') return send(res, 200, 'application/json', readFileSync(new URL('./units.json', DIR)))
    if (req.method === 'GET' && req.url === '/1900iterative.svg') return send(res, 200, 'image/svg+xml', readFileSync(new URL('../geodata/preview/1900iterative.svg', DIR)))
    if (req.method === 'GET' && req.url === '/provinces.json') return send(res, 200, 'application/json', JSON.stringify(loadProvs()))
    if (req.method === 'POST' && (req.url === '/save' || req.url === '/delete')) {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const data = JSON.parse(body || '{}')
        let provs = loadProvs()
        if (req.url === '/save') {
          const sel = new Set(data.cells)
          // a cell belongs to one province: strip selected cells from any other province
          provs = provs.map((p) => (p.name === data.name ? p : { ...p, cells: p.cells.filter((c) => !sel.has(c)) })).filter((p) => p.name === data.name || p.cells.length)
          const ex = provs.find((p) => p.name === data.name)
          if (ex) ex.cells = data.cells
          else provs.push({ name: data.name, cells: data.cells })
        } else {
          provs = provs.filter((p) => p.name !== data.name)
        }
        writeFileSync(PROV, JSON.stringify(provs, null, 2))
        send(res, 200, 'application/json', JSON.stringify(provs))
      })
      return
    }
    send(res, 404, 'text/plain', 'not found')
  } catch (e) { send(res, 500, 'text/plain', String(e)) }
})
server.listen(PORT, () => console.log(`\nMap editor running:  http://localhost:${PORT}\n(provinces saved to tools/map-editor/provinces.json)\n`))
