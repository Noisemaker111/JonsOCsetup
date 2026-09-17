import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { join } from 'node:path'

export default defineConfig({
  root: 'site',
  build: { outDir: '../dist', emptyOutDir: true },
  resolve: { alias: { '@': join(import.meta.dirname, 'site/src') } },
  plugins: [react(), tailwindcss(), // One local state directory, so `wrangler d1 migrations apply --local` and the dev server see the same database.
    cloudflare({ configPath: '../wrangler.jsonc', persistState: { path: join(import.meta.dirname, '.wrangler/state') } })],
})
