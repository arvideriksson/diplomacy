import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { backendName, resolveBackend } from './scripts/backend.ts'

// https://vite.dev/config/
export default defineConfig(({ command, isPreview }) => {
  // `npm run dev` targets the local Supabase stack; builds keep the .env / CI secrets
  // (the live project). Override either with BACKEND=local|live — see scripts/backend.ts.
  // VITE_* already in process.env win over .env files, so setting them here is enough.
  if (!isPreview) {
    const name = backendName(command === 'serve' ? 'local' : 'live')
    if (name === 'local') {
      const backend = resolveBackend(name)
      process.env.VITE_SUPABASE_URL = backend.url
      process.env.VITE_SUPABASE_ANON_KEY = backend.anonKey
    }
    process.env.VITE_BACKEND = name
  }
  return { plugins: [svelte()] }
})
