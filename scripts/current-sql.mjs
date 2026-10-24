#!/usr/bin/env node
// Emit supabase/current-functions.sql: the latest definition of every function in
// schema public (and private), folded from supabase/migrations/*.sql in filename order.
//
// Functions are redefined across many migrations, so "what does submit_orders do NOW"
// otherwise means grepping 30 files. This replays them: a `create [or replace]
// function` replaces any earlier definition with the same name + argument types, and
// `drop function` removes it (by signature, or every overload when no args are given).
//
//   node scripts/current-sql.mjs          regenerate the file
//   node scripts/current-sql.mjs --check  exit 1 if the file is stale (for CI)
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = join(root, 'supabase', 'migrations')
const outFile = join(root, 'supabase', 'current-functions.sql')

// ── statement splitter (comments, quoted strings, dollar quotes) ──────────────────
function splitStatements(sql) {
  const out = []
  let start = 0
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    if (c === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i)
      i = nl === -1 ? sql.length : nl + 1
    } else if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end === -1 ? sql.length : end + 2
    } else if (c === "'" || c === '"') {
      i++
      while (i < sql.length) {
        if (sql[i] === c && sql[i + 1] === c) i += 2
        else if (sql[i] === c) { i++; break }
        else i++
      }
    } else if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))
      if (m) {
        const end = sql.indexOf(m[0], i + m[0].length)
        i = end === -1 ? sql.length : end + m[0].length
      } else i++
    } else if (c === ';') {
      out.push(sql.slice(start, i + 1))
      start = i + 1
      i++
    } else i++
  }
  if (sql.slice(start).trim()) out.push(sql.slice(start))
  return out
}

// Drop leading blank lines and any comment block not directly attached to the
// statement (i.e. separated from it by a blank line).
function attachedText(stmt) {
  const lines = stmt.replace(/^\s*\n/, '').split('\n')
  let first = lines.findIndex((l) => l.trim() && !l.trim().startsWith('--'))
  if (first === -1) return null
  let k = first
  while (k > 0 && lines[k - 1].trim().startsWith('--')) k--
  return { body: lines.slice(first).join('\n').trim(), comment: lines.slice(k, first).join('\n') }
}

// Text of the parenthesised list starting at `open` (index of '(').
function parenList(s, open) {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')' && --depth === 0) return s.slice(open + 1, i)
  }
  return ''
}

function splitTopLevel(s) {
  const parts = []
  let depth = 0, cur = '', q = null
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue }
    if (ch === "'" || ch === '"') { q = ch; cur += ch; continue }
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { parts.push(cur); cur = '' } else cur += ch
  }
  if (cur.trim()) parts.push(cur)
  return parts.map((p) => p.trim()).filter(Boolean)
}

const ALIASES = { int: 'integer', int4: 'integer', int8: 'bigint', bool: 'boolean',
  'timestamp with time zone': 'timestamptz', varchar: 'character varying' }

function normType(t) {
  t = t.toLowerCase().replace(/\s+/g, ' ').trim().replace(/^public\./, '')
  return ALIASES[t] ?? t
}

// create: "[mode] name type [default …]" → type. drop: "type" (or "name type").
function argType(arg, named) {
  let a = arg.replace(/\s+(default\b|=)[\s\S]*$/i, '').trim()
  a = a.replace(/^(in|out|inout|variadic)\s+/i, '')
  if (named) a = a.replace(/^[A-Za-z_][A-Za-z0-9_]*\s+/, '')
  return normType(a)
}

const CREATE_RE = /^create\s+(?:or\s+replace\s+)?function\s+([A-Za-z0-9_."]+)\s*\(/i
const DROP_RE = /^drop\s+function\s+(?:if\s+exists\s+)?([A-Za-z0-9_."]+)\s*(\()?/i

function qualify(name) {
  name = name.replace(/"/g, '').toLowerCase()
  return name.includes('.') ? name : `public.${name}`
}

// ── replay ────────────────────────────────────────────────────────────────────────
const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
const defs = new Map() // key -> { name, sig, file, text }
const warnings = []

for (const file of files) {
  const sql = readFileSync(join(migrationsDir, file), 'utf8')
  for (const stmt of splitStatements(sql)) {
    const at = attachedText(stmt)
    if (!at) continue
    const { body, comment } = at
    const bare = body.replace(/--[^\n]*/g, '') // signatures may carry trailing comments
    let m
    if ((m = CREATE_RE.exec(bare))) {
      const name = qualify(m[1])
      const args = splitTopLevel(parenList(bare, m[0].length - 1))
      const sig = args.map((a) => argType(a, true)).filter((t) => !/^out\b/.test(t)).join(', ')
      const key = `${name}(${sig})`
      defs.delete(key) // re-insert so the output order follows the latest definition
      defs.set(key, { name, sig, file, text: (comment ? comment + '\n' : '') + body })
    } else if ((m = DROP_RE.exec(bare))) {
      const name = qualify(m[1])
      // A drop may list several functions; handle the common single-function form.
      if (m[2]) {
        const sig = splitTopLevel(parenList(bare, m[0].length - 1)).map((a) => argType(a, false)).join(', ')
        const key = `${name}(${sig})`
        if (!defs.delete(key)) {
          const same = [...defs.keys()].filter((k) => k.startsWith(name + '('))
          if (same.length === 1) defs.delete(same[0])
          else if (!/if\s+exists/i.test(body)) warnings.push(`${file}: no definition matches drop of ${key}`)
        }
      } else {
        for (const k of [...defs.keys()]) if (k.startsWith(name + '(')) defs.delete(k)
      }
    }
  }
}

const header = `-- GENERATED by scripts/current-sql.mjs (npm run sql:current) — DO NOT EDIT.
--
-- The current effective definition of every function, folded from
-- supabase/migrations/*.sql in filename order (latest create wins; drops honoured).
-- Read this to see what a function does now; change it by writing a NEW migration
-- that redefines it, then regenerate. Grants, policies and triggers are not included.
`
const sections = [...defs.values()]
  .sort((a, b) => a.name.localeCompare(b.name) || a.sig.localeCompare(b.sig))
  .map((d) => `-- ═══ ${d.name}(${d.sig})  — from ${d.file}\n${d.text}\n`)
const output = header + '\n' + sections.join('\n')

for (const w of warnings) console.warn('warning:', w)

if (process.argv.includes('--check')) {
  const current = existsSync(outFile) ? readFileSync(outFile, 'utf8') : ''
  if (current !== output) {
    console.error('supabase/current-functions.sql is stale — run `npm run sql:current` and commit it.')
    process.exit(1)
  }
  console.log(`supabase/current-functions.sql is up to date (${defs.size} functions).`)
} else {
  writeFileSync(outFile, output)
  console.log(`wrote supabase/current-functions.sql (${defs.size} functions from ${files.length} migrations)`)
}
