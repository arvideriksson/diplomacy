import { chromium } from 'playwright'

const PORT = process.argv[2] || '5176'
const URL = `http://localhost:${PORT}/`
const OUT = process.cwd() + '/.debug-screenshots'

async function main() {
  const fs = await import('fs')
  fs.mkdirSync(OUT, { recursive: true })

  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 3200, height: 2400 } })
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  const mc = await page.locator('.map-container').first()
  const box = await mc.boundingBox()
  if (!box) { console.error('No map container found'); await browser.close(); return }

  const sx = box.width / 610
  const sy = box.height / 560

  function svgToScreen(svgX, svgY) {
    return { x: box.x + svgX * sx, y: box.y + svgY * sy }
  }

  // Full map baseline
  await mc.screenshot({ path: `${OUT}/00-full.png` })
  console.log('Saved full map')

  // Test points for multi-coast territories
  // Each has two points: one on each "side" of the territory
  const tests = [
    // STP: path starts at (534,164), closes back. Test north part and south part
    { name: 'STP-north', svgX: 520, svgY: 60, crop: { x: 380, y: 0, w: 230, h: 190 } },
    { name: 'STP-south', svgX: 450, svgY: 150, crop: { x: 380, y: 0, w: 230, h: 190 } },
    { name: 'STP-center', svgX: 480, svgY: 100, crop: { x: 380, y: 0, w: 230, h: 190 } },

    // SPA: test north and south halves
    { name: 'SPA-north', svgX: 70, svgY: 430, crop: { x: 10, y: 390, w: 160, h: 120 } },
    { name: 'SPA-south', svgX: 90, svgY: 465, crop: { x: 10, y: 390, w: 160, h: 120 } },
    { name: 'SPA-center', svgX: 80, svgY: 450, crop: { x: 10, y: 390, w: 160, h: 120 } },

    // BUL: test east and south halves
    { name: 'BUL-east', svgX: 410, svgY: 435, crop: { x: 310, y: 400, w: 130, h: 80 } },
    { name: 'BUL-south', svgX: 380, svgY: 455, crop: { x: 310, y: 400, w: 130, h: 80 } },

    // Dead zones that should NOT trigger hover
    { name: 'SWITZERLAND', svgX: 215, svgY: 375, crop: { x: 190, y: 350, w: 60, h: 50 } },
    { name: 'OCEAN-atlantic', svgX: 50, svgY: 300, crop: { x: 20, y: 270, w: 80, h: 70 } },

    // Normal territories for comparison
    { name: 'PAR', svgX: 155, svgY: 355, crop: { x: 130, y: 330, w: 60, h: 50 } },
    { name: 'MOS', svgX: 500, svgY: 250, crop: { x: 420, y: 200, w: 150, h: 120 } },
  ]

  for (const test of tests) {
    const screen = svgToScreen(test.svgX, test.svgY)

    // Move mouse to position
    await page.mouse.move(screen.x, screen.y)
    await page.waitForTimeout(200)

    // Crop screenshot around the area
    const clip = {
      x: box.x + test.crop.x * sx,
      y: box.y + test.crop.y * sy,
      width: test.crop.w * sx,
      height: test.crop.h * sy,
    }

    await page.screenshot({ path: `${OUT}/hover-${test.name}.png`, clip })
    console.log(`Hover ${test.name}: mouse at SVG(${test.svgX}, ${test.svgY})`)
  }

  // Also click STP to test selection border covers full territory
  const stpScreen = svgToScreen(480, 100)
  await page.mouse.click(stpScreen.x, stpScreen.y)
  await page.waitForTimeout(300)
  await page.screenshot({
    path: `${OUT}/click-STP.png`,
    clip: { x: box.x + 380 * sx, y: box.y, width: 230 * sx, height: 190 * sy },
  })
  console.log('Click STP: selection border test')

  // Click SPA
  const spaScreen = svgToScreen(80, 450)
  await page.mouse.click(spaScreen.x, spaScreen.y)
  await page.waitForTimeout(300)
  await page.screenshot({
    path: `${OUT}/click-SPA.png`,
    clip: { x: box.x + 10 * sx, y: box.y + 390 * sy, width: 160 * sx, height: 120 * sy },
  })
  console.log('Click SPA: selection border test')

  console.log(`\nAll screenshots in ${OUT}/`)
  console.log('Check:')
  console.log('  - STP-north and STP-south should BOTH show hover highlight on the SAME territory')
  console.log('  - SPA-north and SPA-south should BOTH show hover highlight on the SAME territory')
  console.log('  - BUL-east and BUL-south should BOTH show hover highlight')
  console.log('  - SWITZERLAND and OCEAN should show NO hover highlight')
  console.log('  - click-STP and click-SPA should show selection border around the FULL territory')

  await browser.close()
}

main().catch(console.error)
