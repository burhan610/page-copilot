import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'Page Copilot',
  description:
    'Summarize, question, explain and translate the page you are reading with an AI copilot in the Chrome side panel.',
  version: '1.0.0',
  minimum_chrome_version: '116',
  permissions: [
    'activeTab',
    'scripting',
    'storage',
    'sidePanel',
    'contextMenus',
    'tabs',
  ],
  host_permissions: [
    'https://generativelanguage.googleapis.com/*',
    'https://api.groq.com/*',
    'https://api.openai.com/*',
    // Local llama.cpp server (llama-server), reached over loopback only.
    'http://127.0.0.1:8090/*',
  ],
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/content-script.ts'],
      run_at: 'document_idle',
    },
  ],
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  action: {
    default_title: 'Open Page Copilot',
    default_icon: {
      16: 'icons/icon16.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
  },
  icons: {
    16: 'icons/icon16.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
})
