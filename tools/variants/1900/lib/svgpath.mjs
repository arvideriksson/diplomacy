// Flatten SVG path data (M/L/H/V/C/Z, absolute or relative) into closed rings of [x, y].
// Cubic curves are sampled about every 2 units.
export function pathRings(d) {
  const ts = d.match(/[a-df-zA-DF-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g)
  const rings = []
  let i = 0, cmd, x = 0, y = 0, sx = 0, sy = 0, ring = []
  const close = () => { if (ring.length > 2) rings.push(ring); ring = [] }
  const point = (a, b) => { x = a; y = b; ring.push([x, y]) }
  while (i < ts.length) {
    if (/^[a-z]$/i.test(ts[i])) cmd = ts[i++]
    const rel = cmd === cmd.toLowerCase(), c = cmd.toLowerCase()
    if (c === 'z') { close(); x = sx; y = sy; cmd = null; continue }
    if (c === 'm') { close(); point((rel ? x : 0) + +ts[i++], (rel ? y : 0) + +ts[i++]); sx = x; sy = y; cmd = rel ? 'l' : 'L' }
    else if (c === 'l') point((rel ? x : 0) + +ts[i++], (rel ? y : 0) + +ts[i++])
    else if (c === 'h') point((rel ? x : 0) + +ts[i++], y)
    else if (c === 'v') point(x, (rel ? y : 0) + +ts[i++])
    else if (c === 'c') {
      const v = ts.slice(i, i + 6).map(Number); i += 6
      const ox = x, oy = y, ax = (rel ? x : 0) + v[0], ay = (rel ? y : 0) + v[1], bx = (rel ? x : 0) + v[2], by = (rel ? y : 0) + v[3], ex = (rel ? x : 0) + v[4], ey = (rel ? y : 0) + v[5]
      const n = Math.max(2, Math.ceil((Math.hypot(ax - ox, ay - oy) + Math.hypot(bx - ax, by - ay) + Math.hypot(ex - bx, ey - by)) / 2))
      for (let k = 1; k <= n; k++) { const t = k / n, u = 1 - t; point(u * u * u * ox + 3 * u * u * t * ax + 3 * u * t * t * bx + t * t * t * ex, u * u * u * oy + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * ey) }
    } else throw new Error(`Unsupported path command ${cmd}`)
  }
  close()
  return rings
}

export const ringsPath = (rings, digits = 1) => {
  const k = 10 ** digits, r = (n) => Math.round(n * k) / k
  return rings.map((ring) => ring.map((p, i) => (i ? 'L' : 'M') + r(p[0]) + ' ' + r(p[1])).join('') + 'Z').join('')
}
