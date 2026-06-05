// Bundle entry for the Supabase Edge Function. `npm run build:edge` esbuild-bundles
// this into supabase/functions/adjudicate/_engine.mjs — one self-contained ESM file
// with all relative imports resolved, so the Deno bundler never has to reach across
// the src ↔ functions boundary or resolve extensionless specifiers.

export { adjudicate, boardFromUnits, initialBoard, idleNations } from './index'
export { getMap } from '../maps/index'
