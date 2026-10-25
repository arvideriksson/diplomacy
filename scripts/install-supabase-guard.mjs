// postinstall: repoint node_modules/.bin/supabase at scripts/supabase-guard.mjs, so
// every `supabase` run from this repo is checked first. src/lib/__tests__/supabaseGuard.test.ts
// fails CI if this ever stops being the case.

import { chmodSync, existsSync, lstatSync, symlinkSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const bin = fileURLToPath(new URL('../node_modules/.bin/supabase', import.meta.url))
const guard = fileURLToPath(new URL('./supabase-guard.mjs', import.meta.url))

if (!existsSync(fileURLToPath(new URL('../node_modules/supabase', import.meta.url)))) process.exit(0)
chmodSync(guard, 0o755)
try {
  lstatSync(bin)
  unlinkSync(bin)
} catch {
  // no existing bin entry
}
symlinkSync('../../scripts/supabase-guard.mjs', bin)
