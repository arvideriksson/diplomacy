description: Launch the Diplomacy web app and screenshot it for visual debugging

## How to launch

The app is a Vite + Svelte project.

```bash
# Kill any existing dev server
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

Uses Playwright (already installed as a dev dependency):

```bash
node -e "
import('playwright').then(async ({ chromium }) => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/diplomacy-screenshot.png', fullPage: true });
  console.log('Screenshot saved to /tmp/diplomacy-screenshot.png');
  await browser.close();
}).catch(e => console.error(e));
"
```

Then read `/tmp/diplomacy-screenshot.png` to view the result.

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

## Type-checking

```bash
npx svelte-check --threshold error
```

## Notes

- The map SVG paths come from the Wikimedia Commons Diplomacy.svg (CC BY-SA 3.0)
- ViewBox is `0 0 610 560`
- Territory label positions from the SVG use `text-anchor="start"` (left-aligned from the coordinate)
- Multi-coast territories (SPA, STP, BUL) have coast markers rendered as italic labels
- Sea zones use class `s1` (blue), land uses class `s4` (yellow) in the original SVG
- The dev server auto-reloads on file changes — just screenshot again after edits
