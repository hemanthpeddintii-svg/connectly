import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const apiTarget = process.env.API_URL ?? 'http://127.0.0.1:3001'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Lets a Cloudflare quick tunnel (random *.trycloudflare.com address) reach the dev server for testing.
    allowedHosts: ['.trycloudflare.com'],
    proxy: { '/v0': { target: apiTarget, changeOrigin: true, ws: true } },
  },
})
