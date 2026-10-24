// Stand up a full seven-player Diplomacy game from a single machine — no Google
// accounts, no browser. Each "player" is an independent anonymous Supabase session
// (its own auth.uid + JWT), so this exercises the real anonymous-auth + RLS + RPC
// path end to end: create → join → claim → start → submit orders → (resolve).
//
// Prereq: anonymous sign-ins enabled in Supabase Auth settings.
// Run:     npm run test:7p
//          node --experimental-strip-types scripts/seven-player-game.mjs
//
// Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from .env. Points at whatever
// project that .env targets — if it's your cloud project, readying all seven also
// trips the live cron + adjudicator Edge Function, so the poll at the end watches a
// real Spring-1901 resolution.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// ── env ──────────────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)
const URL_ = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_ANON_KEY
if (!URL_ || !KEY) throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env')

// Starting board comes straight from the map definition (type-only imports, so it
// loads under Node's --experimental-strip-types).
// Import classical.ts directly (it has only type imports, so nothing to resolve at
// runtime) — going through index.ts would pull in an extensionless re-export Node
// ESM can't resolve.
const { classicalMap: map } = await import('../src/lib/maps/classical.ts')
const POWERS = map.powers.map((p) => p.id) // ['england', 'france', ...] — 7 of them

const log = (...a) => console.log(...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Each player gets an isolated client (its own in-memory session store).
function freshClient() {
  return createClient(URL_, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function main() {
  log('Signing in 7 anonymous players…')
  const players = await Promise.all(
    Array.from({ length: 7 }, async (_, i) => {
      const client = freshClient()
      const { data, error } = await client.auth.signInAnonymously({
        options: { data: { full_name: `Tester ${i + 1}`, name: `Tester ${i + 1}` } },
      })
      if (error) throw new Error(`anon sign-in ${i + 1} failed: ${error.message}`)
      return { client, id: data.user.id, label: `Tester ${i + 1}`, nation: POWERS[i] }
    }),
  )
  const host = players[0]
  log(`  ✓ ${players.map((p) => p.id.slice(0, 8)).join(', ')}`)

  // ── host creates a public lobby (mirrors createGame in src/lib/game.ts) ──────
  log('Host creates a public game…')
  const { data: game, error: createErr } = await host.client
    .from('games')
    .insert({
      name: `7p smoke ${new Date().toISOString().slice(0, 16)}`,
      phase: 'lobby',
      year: 1901,
      season: 'Spring',
      map_id: 'classical',
      players: {
        [host.id]: { role: 'host', display_name: host.label, joined_at: new Date().toISOString() },
      },
      // settings omitted: the column default is the server's canonical default
      is_private: false,
      created_by: host.id,
    })
    .select()
    .single()
  if (createErr) throw new Error(`createGame failed: ${createErr.message}`)
  log(`  ✓ game ${game.id}`)

  // ── the other six join via the RLS-guarded public-join RPC ───────────────────
  log('Six players join…')
  for (const p of players.slice(1)) {
    const { error } = await p.client.rpc('join_public_game', { game_id: game.id })
    if (error) throw new Error(`${p.label} join failed: ${error.message}`)
  }

  // ── everyone claims a distinct power ─────────────────────────────────────────
  log('Each player claims a power…')
  for (const p of players) {
    const { error } = await p.client.rpc('claim_nation', { p_game_id: game.id, p_nation: p.nation })
    if (error) throw new Error(`${p.label} claim ${p.nation} failed: ${error.message}`)
    log(`  ✓ ${p.label} → ${p.nation}`)
  }

  // ── host starts the game (start_game RPC: deals powers, opens movement) ─────
  log('Host starts the game…')
  const { error: startErr } = await host.client.rpc('start_game', { p_game_id: game.id })
  if (startErr) throw new Error(`startGame failed: ${startErr.message}`)
  // The server leaves the snapshot null, i.e. the map's opening position.
  const units = map.startingUnits.map((u) => ({ nation: u.power, territory: u.territory, coast: u.coast }))
  log(`  ✓ movement phase, ${units.length} units on the board`)

  // ── each player submits Hold orders for its units and readies ────────────────
  log('Each player submits Spring 1901 hold orders and readies…')
  for (const p of players) {
    const orders = units
      .filter((u) => u.nation === p.nation)
      .map((u) => ({ type: 'Hold', nation: p.nation, source: u.territory, sourceCoast: u.coast }))
    const { error } = await p.client.rpc('submit_orders', {
      p_game_id: game.id,
      p_orders: orders,
      p_ready: true,
    })
    if (error) throw new Error(`${p.label} submit failed: ${error.message}`)
    log(`  ✓ ${p.label} submitted ${orders.length} holds, ready`)
  }

  // ── watch for the live adjudicator to resolve the turn (best-effort) ──────────
  log('All powers ready. Polling ~90s for the adjudicator to resolve…')
  for (let i = 0; i < 18; i++) {
    await sleep(5000)
    const { data: g } = await host.client
      .from('games')
      .select('year, season, phase')
      .eq('id', game.id)
      .single()
    if (!(g.year === 1901 && g.season === 'Spring' && g.phase === 'movement')) {
      log(`  ✓ resolved → ${g.season} ${g.year} (${g.phase})`)
      log('\n✅ Full seven-player lifecycle works end to end.')
      return
    }
  }
  log('  … still Spring 1901 movement after 90s.')
  log('     Lobby + join + claim + start + submit all succeeded.')
  log("     If this .env points at a paused/free project, the cron may be idle —")
  log('     resolution fires once the scheduler ticks. Game id: ' + game.id)
}

main().catch((e) => {
  console.error('\n❌ ' + e.message)
  process.exit(1)
})
