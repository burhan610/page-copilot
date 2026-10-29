# Page Copilot

**Page Copilot** is a Chrome extension that puts an AI assistant in your side panel. It can summarize the current web page, answer questions about it, explain selected text, and translate text — using either your own AI API key or a free local model served by [llama.cpp](https://github.com/ggml-org/llama.cpp). No backend, no tracking, no server.

## What it does

| Feature | Description |
|---|---|
| **Summarize** | Condense the page into a short gist, key points, or detailed notes. Uses map-reduce for long pages. |
| **Ask a question** | Ask free-form questions about the page; answers are grounded in the page content. |
| **Explain selection** | Right-click any text on the page and choose "Explain with Page Copilot". |
| **Translate selection** | Right-click any text and choose "Translate with Page Copilot". |
| **Translate page** | Translate the entire page into your chosen language. |
| **Page chat** | Ask follow-up questions about the page; up to 10 recent messages are supplied as context. |
| **Settings** | Choose cloud or local mode, enter an API key, and configure the local model, response language, and summary length. Cloud providers are detected from the key. |

## Setup

For a prebuilt Chrome/Edge ZIP, installation instructions, and release steps,
see [DEPLOYMENT.md](DEPLOYMENT.md). Read [PRIVACY.md](PRIVACY.md) for data handling details.

### Option A: Local model (llama.cpp, free — no API key)

Runs entirely on your machine. Nothing is sent to any cloud service.

1. **Get llama.cpp**: download a Windows build from <https://github.com/ggml-org/llama.cpp/releases> — `llama-<tag>-bin-win-cpu-x64.zip`, or the `llama-<tag>-bin-win-cuda-<ver>-x64.zip` build plus its matching `cudart-llama-bin-win-cuda-<ver>-x64.zip` if you want GPU acceleration — and unzip it somewhere like `%LOCALAPPDATA%\llamacpp`.
2. **Download a model**: get a GGUF file and drop it in a `models` folder next to `llama-server.exe`. A good small default for a 4 GB GPU is [`Qwen2.5-1.5B-Instruct-Q4_K_M.gguf`](https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF) (~1 GB).
3. **Start the server**:

   ```bash
   llama-server.exe -m models\Qwen2.5-1.5B-Instruct-Q4_K_M.gguf --alias qwen2.5-1.5b --port 8090
   ```

4. **Load the extension**: Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the `dist` folder of this project.
5. **Enable the local model**: In the side panel, click the gear icon → turn on **Local model** → pick your model from the dropdown → save. No API key needed.

> The extension talks to `http://127.0.0.1:8090`, llama.cpp's OpenAI-compatible API. It binds the loopback interface, so only your machine can reach it.

> **If the panel says the local server is unreachable**: it is not running — start `llama-server` and try again. If Chrome shows a local network access prompt, choose **Allow**.

> **To serve a different model**: download another GGUF and start `llama-server` with it (`-m <other.gguf> --alias <name>`); it appears in the dropdown when you reopen Settings.

### Option B: Google Gemini

1. **Get a Gemini API key**: Go to <https://aistudio.google.com/api-keys> and create a key.
2. **Load the extension**: Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the `dist` folder of this project.
3. **Open the side panel**: Click the Page Copilot icon in the Chrome toolbar.
4. **Enter your API key**: In the side panel, click the gear icon → paste your Gemini API key → save. The key is stored locally in `chrome.storage.local` and never synced.

### Option C: OpenAI

1. **Get an OpenAI API key**: Go to <https://platform.openai.com/api-keys> and create a key.
2. **Load the extension**: Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the `dist` folder of this project.
3. **Open the side panel**: Click the Page Copilot icon in the Chrome toolbar.
4. **Enter your API key**: In Settings, choose **Cloud API**, paste your OpenAI API key, and save. The provider is detected automatically; the extension uses `gpt-4o-mini`.

### Option D: Groq (llama-3.3-70b, etc.)

1. **Get a Groq API key**: Go to <https://console.groq.com/keys> and create a key.
2. **Load the extension**: Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the `dist` folder of this project.
3. **Open the side panel**: Click the Page Copilot icon in the Chrome toolbar.
4. **Enter your API key**: In Settings, choose **Cloud API**, paste your Groq API key, and save. The provider is detected automatically; the extension uses `llama-3.3-70b-versatile`.

## Quick test checklist

- [ ] Summarize a news article with the "Summarize" quick action.
- [ ] Summarize a very long Wikipedia page (tests the map-reduce path).
- [ ] Ask a question that isn't answered on the page → the model should say so.
- [ ] Select a paragraph on any page, right-click → "Explain with Page Copilot".
- [ ] Select text, right-click → "Translate with Page Copilot".
- [ ] Switch tabs mid-session → chat history persists for the original tab, clears on navigation.
- [ ] Stop a streaming response using the Stop button.
- [ ] Enter an invalid API key → shows a friendly error message.
- [ ] Open the panel on `chrome://extensions` → shows a restricted-page message.
- [ ] Turn on the local model in settings → it appears in the dropdown, and a summarize works with no API key.

## Project structure

```
page-copilot/
  public/icons/           # 16, 48, 128 px placeholder PNG icons (generated by scripts/generate-icons.mjs)
  scripts/generate-icons.mjs  # Generates the placeholder icons
  src/
    manifest.config.ts    # Manifest V3 definition using @crxjs/vite-plugin
    background/service-worker.ts  # Context menus, side panel behavior, LLM orchestration with streaming
    content/content-script.ts     # Readability extraction + message listener (GET_PAGE_CONTENT, GET_SELECTION)
    lib/
      extract.ts        # Text cleaning, chunking, restricted-page detection
      llm.ts            # Multi-provider LLM client (OpenAI, Gemini, Groq, local llama.cpp) + SSE parsing + LLMProvider interface
      prompts.ts        # System prompts for each action + map-reduce logic
      messaging.ts      # Typed helpers: sendToTab, sendToBackground, connectToBackground
      storage.ts        # Typed chrome.storage wrappers (sync for settings, local for API key)
    sidepanel/
      index.html        # Side panel entry point
      main.tsx          # React root render
      App.tsx           # Main layout: Header + PageContext + ChatWindow + QuickActions + Composer + SettingsPanel
      components/
        ChatWindow.tsx          # Message list with auto-scroll, markdown rendering, empty/loading states
        MessageBubble.tsx       # User/assistant bubbles with copy button + markdown (react-markdown + remark-gfm)
        QuickActions.tsx        # Buttons: Summarize, Key points, ELI5, Translate
        SettingsPanel.tsx       # Cloud/local toggle, API key, local model field, language, summary length, connection test
        ErrorBanner.tsx         # Friendly error messages with codes (missing-key, rate-limit, network, etc.)
      hooks/
        useActiveTab.ts       # Tracks active tab, detects restricted pages, favicon updates
        useChat.ts            # Streaming state, history persistence, port communication with background
        useSettings.ts        # Settings sync persistence, API key local storage, test key flow
    types/index.ts        # Shared TypeScript contracts (Settings, ChatMessage, ActionKind, ErrorCode, etc.)
  package.json                    # Dependencies + build scripts
  vite.config.ts                # Vite + React + @crxjs/vite-plugin config
  tsconfig.json                 # Strict TypeScript config with chrome types
  tailwind.config.js            # Tailwind CSS with brand colors + media dark mode
  postcss.config.js             # Autoprefixer + Tailwind plugins
  eslint.config.js              # ESLint + React Hooks + @typescript-eslint
  .prettierrc.json              # Prettier formatting config
  .prettierignore               # Prettier ignore rules
  .gitignore                    # Git ignore rules
```

## Known limitations

- Only works on regular web pages. Does not run on `chrome://` pages, the Chrome Web Store, or PDFs.
- The AI provider API is called directly from the extension; page text is sent to the AI provider (cloud or your local model server) only when the user triggers an action.
- API key is stored in `chrome.storage.local` only — it is never synced to Google accounts or backed up.
- Long-page summarization uses a chunk-based map-reduce approach; very long pages may take a few seconds.
- The extension requires Chrome 116+ for the side panel API.
- Local model mode requires the local llama.cpp server to be running; if it is stopped, the extension shows a friendly network error with a hint to start `llama-server`.
- Small local models (e.g. `qwen3.5:0.8b`) answer quickly but are less accurate than cloud models; large models need more RAM/VRAM than some laptops have.

## Development

```bash
# Install dependencies
npm install

# Check TypeScript types
npm run typecheck

# Run regression tests (mocked providers; no API key or local server needed)
npm test

# Run lint
npm run lint

# Build for production
npm run build

# Rebuild the extension when files change (reload it in the browser afterward)
npm run dev
```

## Credits

- Uses [@mozilla/readability](https://mozilla.github.io/readability/) for main-content extraction
- Uses [react-markdown](https://github.com/react-markdown/react-markdown) + [remark-gfm](https://github.com/remarkjs/remark-gfm) for markdown rendering
- Uses [@crxjs/vite-plugin](https://crxjs.dev/) for Manifest V3 builds
- UI styled with [Tailwind CSS](https://tailwindcss.com/)
- **Multi-provider LLM support**: OpenAI (Chat Completions API, `Authorization: Bearer` header), Google Gemini (Generative Language API, `x-goog-api-key` header), Groq (OpenAI-compatible Chat Completions API), and llama.cpp (local `llama-server` at `http://127.0.0.1:8090`, OpenAI-compatible streaming, no API key) — all called directly from the browser extension
