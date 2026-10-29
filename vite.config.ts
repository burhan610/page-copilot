import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './src/manifest.config'

// CRXJS can wrap content scripts in a runtime.getURL() helper that Chromium
// rejects from content scripts on strict pages (for example YouTube). Build the
// content script as a normal entry so the compiled file is self-contained and
// Chrome can inject it directly from the extension directory.
export default defineConfig({
  plugins: [react(), crx({ manifest, contentScripts: { standaloneFiles: ['src/content/content-script.ts'] } })],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome116',
    sourcemap: false,
    rollupOptions: {
      input: {
        index: 'src/sidepanel/index.html',
        contentScript: 'src/content/content-script.ts',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
