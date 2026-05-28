description: Launch the Diplomacy web app and screenshot it for visual debugging

## How to launch

The app is a Vite + Svelte project.

```bash
# Kill any existing dev server on common ports
pkill -f 'vite' 2>/dev/null || true
sleep 1

# Start dev server in background
cd /home/arvid/diplomacy
npx vite --host 0.0.0.0 --port 5199 &
echo $! > /tmp/diplomacy-dev.pid

# Wait for it to be ready
timeout 30 bash -c 'until curl -sf http://localhost:5199 >/dev/null; do sleep 1; done'
echo "Dev server ready at http://localhost:5199"
```

## How to screenshot

Uses Playwright (already installed as a dev dependency). **Always take the full map screenshot AND zoomed detail shots**, then READ each image file to actually inspect them visually.

### Full map + detail shots

```bash
node -e "
import('playwright').then(async ({ chromium }) => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 2400, height: 1800 } });
  await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const mc = await page.locator('.map-container').first();
  const box = await mc.boundingBox();
  if (!box) { console.error('Map container not found'); await browser.close(); return; }

  // Full map
  await mc.screenshot({ path: '/tmp/dip-full.png' });

  // Zoomed quadrants — catches rendering bugs in dense areas
  const quads = [
    ['nw', 0, 0],       // Britain, Scandinavia
    ['ne', 0.55, 0],     // Russia, STP
    ['sw', 0, 0.5],      // Iberia (SPA), France
    ['se', 0.5, 0.5],    // Balkans (BUL), Turkey
    ['center', 0.25, 0.25], // Germany, Austria, Italy
  ];
  for (const [name, xOff, yOff] of quads) {
    await page.screenshot({
      path: '/tmp/dip-' + name + '.png',
      clip: {
        x: box.x + box.width * xOff,
        y: box.y + box.height * yOff,
        width: box.width * 0.5,
        height: box.height * 0.5,
      },
    });
  }

  console.log('Screenshots saved: /tmp/dip-full.png and /tmp/dip-{nw,ne,sw,se,center}.png');
  await browser.close();
}).catch(e => console.error(e));
"
```

### IMPORTANT: Read the screenshots

After taking screenshots, you MUST read each image to verify rendering:

```
Read /tmp/dip-full.png    — overall map layout, no stray shapes
Read /tmp/dip-ne.png      — STP coast labels, Russia shapes
Read /tmp/dip-sw.png      — SPA coast labels, Iberia shapes
Read /tmp/dip-se.png      — BUL coast labels, Turkey shapes
Read /tmp/dip-center.png  — dense Europe, Italy, Austria
```

### What to check

- **Unclosed paths**: territories rendering as grey/wrong-colored boxes that bleed outside their borders. SVG paths MUST end with `z`.
- **Overlapping territories**: shapes stacking on top of each other incorrectly.
- **Coast labels**: SPA/nc, SPA/sc, STP/nc, STP/sc, BUL/ec, BUL/sc should be visible as italic text positioned on the correct coastline.
- **Supply center markers**: small circles should appear near territory labels for all 34 supply centers.
- **Unit placement**: 22 starting units with correct power colors in the right territories.
- **Sea zones**: should be lighter blue (#99ccff) with territory labels.

## How to stop

```bash
kill $(cat /tmp/diplomacy-dev.pid) 2>/dev/null
pkill -f 'vite' 2>/dev/null || true
```

## Key files

- Map definition types: `src/lib/mapDefinition.ts`
- Standard map data (territories, adjacencies, paths): `src/lib/maps/standard.ts`
- Map renderer component: `src/components/DiplomacyMap.svelte`
- Map registry: `src/lib/maps/index.ts`
- App entry point: `src/App.svelte`
- Original SVG source: `/tmp/diplomacy-wikimedia.svg` (Wikimedia Commons, CC BY-SA 3.0)

## Type-checking

```bash
npx svelte-check --threshold error
```

## Notes

- The map SVG paths come from the Wikimedia Commons Diplomacy.svg (CC BY-SA 3.0, viewBox 0 0 610 560)
- Multi-coast territories (SPA, STP, BUL) have coast data in `coasts` field with fleet adjacency and render positions
- Territory label positions use `text-anchor="start"` (left-aligned)
- The dev server auto-reloads on file changes — just screenshot again after edits
- All SVG paths MUST end with `z` to close the shape. The original Wikimedia SVG has some unclosed paths (SPA, STP, BUL) that cause rendering artifacts if not closed.
