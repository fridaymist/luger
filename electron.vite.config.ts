import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// Strict content security policy for release builds (dev needs inline scripts for hot reload).
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: luger-bg: https://*.rbxcdn.com https://*.roblox.com https://*.supabase.co; font-src 'self' data:; connect-src 'self'; media-src 'self' luger-bg:"
const csp = (): Plugin => ({
  name: 'luger-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
})

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
    resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
    plugins: [react(), csp()]
  }
})
