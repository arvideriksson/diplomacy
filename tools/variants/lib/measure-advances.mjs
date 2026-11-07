/** Measure the glyph advances of the embedded Libre Baskerville in a browser and write them to
 * `advances.json` (next to this file), as a fraction of the font size, rounded to 0.01.
 * Run: node tools/variants/lib/measure-advances.mjs [--check]
 *
 * Each face is loaded from the app's own font files (src/assets/fonts/), exactly as the boards
 * embed them, and each character is set alone in an SVG <text> at 100px; its
 * getComputedTextLength() is the advance. `__sample` is the measured width of "Constantinople"
 * as a whole, a check that summing per-character advances (no kerning) is close enough.
 * --check only compares with the committed file (exit 1 on any difference).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const out = new URL('./advances.json', import.meta.url)
const font = (f) => readFileSync(new URL(`../../../src/assets/fonts/${f}`, import.meta.url)).toString('base64')
// The faces the boards use: upright regular and bold (one variable font, 400-700) and italic.
const FACES = {
  regular: 'font-style:normal;font-weight:400',
  bold: 'font-style:normal;font-weight:700',
  italic: 'font-style:italic;font-weight:400',
}
// Every character a board label may use.
const CHARS = [' ', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', '-', '.', "'", '’', ',']
const SAMPLE = 'Constantinople'

const html = `<!doctype html><style>
@font-face{font-family:'LB';font-style:normal;font-weight:400 700;src:url(data:font/woff2;base64,${font('LibreBaskerville-latin.woff2')}) format('woff2')}
@font-face{font-family:'LB';font-style:italic;font-weight:400;src:url(data:font/woff2;base64,${font('LibreBaskerville-Italic-latin.woff2')}) format('woff2')}
</style><svg xmlns="http://www.w3.org/2000/svg" width="2000" height="200"><text id="t" x="0" y="150" font-family="LB" font-size="100"></text></svg>`

const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent(html)
const measured = await page.evaluate(async ({ FACES, CHARS, SAMPLE }) => {
  await Promise.all(Object.values(FACES).map((s) => document.fonts.load(`${s.includes('italic') ? 'italic' : 'normal'} ${s.match(/\d+$/)[0]} 100px LB`)))
  const t = document.getElementById('t'), r = (v) => Math.round(v) / 100
  const res = {}
  for (const [face, style] of Object.entries(FACES)) {
    t.setAttribute('style', style + ';white-space:pre')
    const len = (s) => { t.textContent = s; return t.getComputedTextLength() }
    res[face] = Object.fromEntries([...CHARS.map((c) => [c, r(len(c))]), ['__sample', r(len(SAMPLE))]])
  }
  return res
}, { FACES, CHARS, SAMPLE })
await browser.close()

const text = JSON.stringify(measured) + '\n'
if (process.argv.includes('--check')) {
  const old = JSON.parse(readFileSync(out, 'utf8'))
  let diff = 0
  for (const face of Object.keys(measured)) for (const c of Object.keys(measured[face])) {
    if (old[face]?.[c] !== measured[face][c]) { diff++; console.log(`${face} ${JSON.stringify(c)}: file ${old[face]?.[c]} measured ${measured[face][c]}`) }
  }
  console.log(diff ? `${diff} differences` : 'advances.json matches the measurement')
  process.exit(diff ? 1 : 0)
}
writeFileSync(out, text)
console.log(`wrote ${out.pathname}`)
