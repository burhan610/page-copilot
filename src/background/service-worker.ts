type RunActionMessage = Extract<UiRequest, { type: 'RUN_ACTION' }>
type PageWideAction = Exclude<ActionKind, SelectionAction>

const EXPLAIN_MENU_ID = 'page-copilot-explain-selection'
const TRANSLATE_MENU_ID = 'page-copilot-translate-selection'

import {
  ActionKind,
  AppError,
  PORT_NAME,
  toErrorInfo,
  type BackgroundEvent,
  type ChatTurn,
  type LLMProvider,
  type PageContent,
  type PendingSelection,
  type RuntimeMessage,
  type SelectionAction,
  type Settings,
  type TestKeyResult,
  type UiRequest,
  type SummaryLength,
} from '../types'
import {
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  chunkText,
  isLongPage,
  isRestrictedUrl,
  selectRelevantChunks,
} from '../lib/extract'
import {
  buildAskMessages,
  buildChunkSystemPrompt,
  buildChunkUserPrompt,
  buildMergeSystemPrompt,
  buildMergeUserPrompt,
  buildSystemPrompt,
  buildTranslateChunkSystemPrompt,
  buildTranslateChunkUserPrompt,
  eli5,
  explainSelection,
  keyPoints,
  summarize,
  translate,
  translateSelection,
} from '../lib/prompts'
import {
  DEFAULT_LOCAL_MODEL,
  complete,
  getProvider,
  getProviderIdFromKey,
  isLocalModelInstalled,
  listLocalModels,
} from '../lib/llm'
import { sendToTab } from '../lib/messaging'
import {
  clearPendingSelection,
  dropChatIfStale,
  getApiKey,
  getSettings,
  peekPendingSelection,
  removeTabState,
  savePendingSelection,
} from '../lib/storage'


const SUMMARY_MAX_TOKENS = 4096
const CHUNK_NOTE_MAX_TOKENS = 1200

const ports = new Set<chrome.runtime.Port>()
const portTabs = new Map<chrome.runtime.Port, number>()
const streamsByPort = new Map<chrome.runtime.Port, Map<string, ActiveStream>>()

type ActiveStream = {
  controller: AbortController
  tabId: number
}

/* ------------------------------------------------------------------ */

/* Setup                                                               */
/* ------------------------------------------------------------------ */


function ensurePanelBehavior(): void {
  try {
    void chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => undefined)
  } catch {
    /* older Chrome builds may not expose the side panel API */
  }
}

function createContextMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: EXPLAIN_MENU_ID,
      title: 'Explain with Page Copilot',
      contexts: ['selection'],
    })
    chrome.contextMenus.create({
      id: TRANSLATE_MENU_ID,
      title: 'Translate with Page Copilot',
      contexts: ['selection'],
    })
  })
}

chrome.runtime.onInstalled.addListener(() => {
  ensurePanelBehavior()
  createContextMenus()
})

chrome.runtime.onStartup.addListener(() => {
  ensurePanelBehavior()
})

ensurePanelBehavior()

function post(port: chrome.runtime.Port, event: BackgroundEvent): void {
  try {
    port.postMessage(event)
  } catch {
    /* the side panel went away */
  }
}

/* ------------------------------------------------------------------ */

/* Context menu -> side panel                                          */
/* ------------------------------------------------------------------ */


function deliverPending(pending: PendingSelection): boolean {
  let delivered = false
  for (const port of ports) {
    if (portTabs.get(port) !== pending.tabId) continue
    post(port, { type: 'SELECTION_ACTION', pending })
    delivered = true
  }
  return delivered
}

async function deliverPendingForTab(tabId: number): Promise<void> {
  const pending = await peekPendingSelection(tabId)
  if (!pending) return
  if (deliverPending(pending)) await clearPendingSelection(tabId, pending.id)
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const tabId = tab?.id
  if (tabId === undefined) return

  const action: SelectionAction | null =
    info.menuItemId === EXPLAIN_MENU_ID
      ? 'explain-selection'
      : info.menuItemId === TRANSLATE_MENU_ID
        ? 'translate-selection'
        : null
  if (!action) return

  const text = typeof info.selectionText === 'string' ? info.selectionText.trim() : ''
  if (!text) return

  const pending: PendingSelection = {
    id: crypto.randomUUID(),
    tabId,
    action,
    text,
    pageTitle: tab?.title ?? '',
    url: tab?.url ?? info.pageUrl ?? '',
    createdAt: Date.now(),
  }

  // Start persisting the action, then open the panel synchronously: Chrome only
  // allows sidePanel.open while it still considers this a user gesture.
  const saved = savePendingSelection(pending)
  try {
    void chrome.sidePanel.open({ tabId }).catch(() => undefined)
  } catch {
    /* the panel may already be open */
  }

  void saved
    .then(() => {
      if (deliverPending(pending)) void clearPendingSelection(tabId, pending.id)
    })
    .catch(() => undefined)
})

/* ------------------------------------------------------------------ */

/* Ports and streams                                                   */
/* ------------------------------------------------------------------ */


chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return

  ports.add(port)
  streamsByPort.set(port, new Map())

  port.onMessage.addListener((message: unknown) => {
    if (!isUiRequest(message)) return

    if (message.type === 'HELLO') {
      portTabs.set(port, message.tabId)
      void deliverPendingForTab(message.tabId)
      return
    }

    if (message.type === 'RUN_ACTION') {
      void handleRunAction(port, message)
      return
    }

    if (message.type === 'STOP_STREAM') {
      streamsByPort.get(port)?.get(message.requestId)?.controller.abort()
    }
  })

  port.onDisconnect.addListener(() => {
    ports.delete(port)
    portTabs.delete(port)
    const streams = streamsByPort.get(port)
    if (streams) {
      for (const stream of streams.values()) stream.controller.abort()
      streamsByPort.delete(port)
    }
  })
})

function isUiRequest(message: unknown): message is UiRequest {
  if (typeof message !== 'object' || message === null) return false
  const record = message as Record<string, unknown>

  if (record['type'] === 'HELLO') return typeof record['tabId'] === 'number'
  if (record['type'] === 'STOP_STREAM') return typeof record['requestId'] === 'string'
  if (record['type'] === 'RUN_ACTION') {
    return (
      typeof record['requestId'] === 'string' &&
      typeof record['tabId'] === 'number' &&
      typeof record['action'] === 'string'
    )
  }
  return false
}

async function handleRunAction(port: chrome.runtime.Port, request: RunActionMessage): Promise<void> {
  const controllers = streamsByPort.get(port)
  if (!controllers) return

  const controller = new AbortController()
  controllers.set(request.requestId, { controller, tabId: request.tabId })

  const { requestId } = request
  const postChunk = (text: string) =>
    post(port, { type: 'STREAM_CHUNK', requestId, text })
  const postProgress = (message: string) =>
    post(port, { type: 'STREAM_PROGRESS', requestId, message })

  try {
    const [settings, apiKey] = await Promise.all([getSettings(), getApiKey()])

    // A local model needs no key; otherwise auto-detect from the key prefix
    // (sk- = OpenAI, gsk_ = Groq, AIza/AQ = Gemini).
    const providerId = settings.useLocal ? 'local' : getProviderIdFromKey(apiKey)
    if (providerId !== 'local' && !apiKey.trim()) {
      throw new AppError('missing-key', 'No API key is configured.')
    }
    const provider = getProvider(providerId)
    const model = resolveModel(providerId, settings)

    const action = request.action
    if (action === 'explain-selection' || action === 'translate-selection') {
      await runSelectionAction(
        port,
        request,
        action,
        settings,
        apiKey,
        controller.signal,
        provider,
        model,
      )
    } else {
      await runPageAction(
        request,
        action,
        settings,
        apiKey,
        controller.signal,
        postChunk,
        postProgress,
        provider,
        model,
      )
    }

    post(port, { type: 'STREAM_DONE', requestId })
  } catch (error) {
    if (controller.signal.aborted) {
      post(port, { type: 'STREAM_DONE', requestId, stopped: true })
      return
    }
    post(port, { type: 'STREAM_ERROR', requestId, error: toErrorInfo(error) })
  } finally {
    controllers.delete(requestId)
  }
}

/* ------------------------------------------------------------------ */

/* Actions                                                             */
/* ------------------------------------------------------------------ */


async function runSelectionAction(
  port: chrome.runtime.Port,
  request: RunActionMessage,
  action: SelectionAction,
  settings: Settings,
  apiKey: string,
  signal: AbortSignal,
  provider: LLMProvider,
  model: string,
): Promise<void> {
  const selection = (request.selection ?? '').trim()
  if (!selection) {
    throw new AppError('no-selection', 'Select some text on the page first.', 'Select some text on the page first.')
  }

  const tab = await getTab(request.tabId)
  const language = settings.language
  const isExplain = action === 'explain-selection'

  post(port, {
    type: 'STREAM_PROGRESS',
    requestId: request.requestId,
    message: isExplain ? 'Explaining the selection…' : `Translating to ${language}…`,
  })

  await provider.streamCompletion({
    system: buildSystemPrompt({
      language,
      page: { title: tab.title ?? '', url: tab.url ?? '' },
      selection,
    }),
    messages: [{ role: 'user', content: isExplain ? explainSelection() : translateSelection(language) }],        model,

    apiKey,
    signal,
    maxTokens: 4096,
    onChunk: (text) => post(port, { type: 'STREAM_CHUNK', requestId: request.requestId, text }),
  })
}

async function runPageAction(
  request: RunActionMessage,
  action: PageWideAction,
  settings: Settings,
  apiKey: string,
  signal: AbortSignal,
  postChunk: (text: string) => void,
  postProgress: (message: string) => void,
  provider: LLMProvider,
  model: string,
): Promise<void> {
  postProgress('Reading the page…')
  const page = await loadPageContent(request.tabId)
  const text = page.text.trim()

  if (text.length < 40) {
    throw new AppError(
      'empty-page',
      'This page has no readable text.',
      'Page Copilot could not find readable text on this page. It may be empty, blocked, or still loading.',
    )
  }

  const language = settings.language

  if (action === 'ask') {
    const question = (request.question ?? '').trim()
    if (!question) {
      throw new AppError('bad-request', 'Ask a question first.', 'Type a question about the page first.')
    }

    const long = isLongPage(text)
    let promptPage: PageContent = page
    if (long) {
      const chunks = chunkText(text, CHUNK_SIZE, CHUNK_OVERLAP)
      const relevant = selectRelevantChunks(chunks, question, 4)
      promptPage = { ...page, text: relevant.join('\n\n— — —\n\n') }
    }

    postProgress(long ? 'Searching the page for the answer…' : 'Thinking…')

    await provider.streamCompletion({
      system: buildSystemPrompt({ language, page: promptPage, pageIsExcerpt: long }),
      messages: buildAskMessages(question, normalizeHistory(request.history)),
      model,
      apiKey,
      signal,
      maxTokens: 4096,
      onChunk: postChunk,
    })
    return
  }

  const instruction = pageInstruction(action, settings.summaryLength, language)

  if (!isLongPage(text)) {
    postProgress('Thinking…')
    await provider.streamCompletion({
      system: buildSystemPrompt({ language, page }),
      messages: [{ role: 'user', content: instruction }],
      model,
      apiKey,
      signal,
      maxTokens: SUMMARY_MAX_TOKENS,
      onChunk: postChunk,
    })
    return
  }

  if (action === 'translate') {
    // Translate sequentially so the whole page can be streamed in readable
    // order, without overlapping duplicated sentences.
    const chunks = chunkText(text, 8000, 0)
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index]
      if (!chunk) continue
      if (signal.aborted) throw new AppError('aborted', 'The request was stopped.')

      postProgress(`Translating part ${index + 1} of ${chunks.length}…`)
      if (index > 0) postChunk('\n\n')

      await provider.streamCompletion({
        system: buildTranslateChunkSystemPrompt(language),
        messages: [
          {
            role: 'user',
            content: buildTranslateChunkUserPrompt(chunk, index + 1, chunks.length),
          },
        ],
        model,
        apiKey,
        signal,
        maxTokens: SUMMARY_MAX_TOKENS,
        onChunk: postChunk,
      })
    }
    return
  }

  // Map: extract notes from each part. Reduce: merge them into the answer.
  const chunks = chunkText(text, CHUNK_SIZE, CHUNK_OVERLAP)
  const notes: string[] = []

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    if (!chunk) continue
    if (signal.aborted) throw new AppError('aborted', 'The request was stopped.')

    postProgress(`Reading part ${index + 1} of ${chunks.length}…`)
    // Buffer the streamed note through the resolved provider so every provider
    // (not just the default) works on the map-reduce path.
    let note = ''
    await provider.streamCompletion({
      system: buildChunkSystemPrompt({
        language,
        pageTitle: page.title,
        pageUrl: page.url,
        part: index + 1,
        total: chunks.length,
      }),
      messages: [
        { role: 'user', content: buildChunkUserPrompt(chunk, index + 1, chunks.length) },
      ],
      model,
      apiKey,
      signal,
      maxTokens: CHUNK_NOTE_MAX_TOKENS,
      onChunk: (piece) => {
        note += piece
      },
    })

    const trimmed = note.trim()
    if (trimmed && !/^NO USEFUL CONTENT$/i.test(trimmed)) notes.push(trimmed)
  }

  if (notes.length === 0) {
    throw new AppError(
      'empty-page',
      'The page had no useful text to summarize.',
      'Page Copilot could not find meaningful content on this page.',
    )
  }

  postProgress('Writing the final answer…')
  await provider.streamCompletion({
    system: buildMergeSystemPrompt(language),
    messages: [
      {
        role: 'user',
        content: buildMergeUserPrompt(
          instruction,
          notes.map((note) => note.slice(0, 6000)),
          notes.length,
        ),
      },
    ],        model,

    apiKey,
    signal,
    maxTokens: SUMMARY_MAX_TOKENS,
    onChunk: postChunk,
  })
}

/** Model to send for each provider. The local model is user-configurable. */
function resolveModel(providerId: string, settings: Settings): string {
  if (providerId === 'local') return settings.localModel || DEFAULT_LOCAL_MODEL
  if (providerId === 'groq') return 'llama-3.3-70b-versatile'
  if (providerId === 'openai') return 'gpt-4o-mini'
  return 'gemini-2.5-flash'
}

function pageInstruction(action: PageWideAction, length: SummaryLength, language: string): string {
  switch (action) {
    case 'summarize':
      return summarize(length)
    case 'key-points':
      return keyPoints(length)
    case 'eli5':
      return eli5()
    case 'translate':
      return translate(language)
    default:
      throw new AppError('bad-request', 'That action is not supported on a page.')
  }
}

function normalizeHistory(history: ChatTurn[] | undefined): ChatTurn[] {
  if (!Array.isArray(history)) return []
  return history
    .filter(
      (turn): turn is ChatTurn =>
        typeof turn === 'object' &&
        turn !== null &&
        (turn.role === 'user' || turn.role === 'assistant') &&
        typeof turn.content === 'string',
    )
    .slice(-10)
}

/* ------------------------------------------------------------------ */

/* Page access                                                         */
/* ------------------------------------------------------------------ */


async function getTab(tabId: number): Promise<chrome.tabs.Tab> {
  try {
    return await chrome.tabs.get(tabId)
  } catch {
    throw new AppError(
      'tab-closed',
      'That tab is no longer open.',
      'That tab was closed or moved. Open a page and try again.',
    )
  }
}

async function injectContentScript(tabId: number): Promise<void> {
  const manifest = chrome.runtime.getManifest()
  const files = (manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? [])
  if (files.length === 0) throw new Error('No content script is registered')

  await chrome.scripting.executeScript({ target: { tabId }, files })
}

async function loadPageContent(tabId: number): Promise<PageContent> {
  const tab = await getTab(tabId)
  const restricted = isRestrictedUrl(tab.url)
  if (restricted) {
    throw new AppError('restricted-page', restricted.message, restricted.message)
  }

  let response
  try {
    response = await sendToTab(tabId, { type: 'GET_PAGE_CONTENT' })
  } catch {
    // Tabs that were already open when the extension was installed have no
    // content script yet, so inject it once and retry.
    try {
      await injectContentScript(tabId)
      response = await sendToTab(tabId, { type: 'GET_PAGE_CONTENT' })
    } catch {
      throw new AppError(
        'content-unavailable',
        'Page Copilot could not read this page.',
        'Page Copilot could not read this page. Reload the page and try again. If it still fails it may be a Chrome page, a PDF, or a site that blocks extensions.',
      )
    }
  }

  if (response.type === 'CONTENT_ERROR') {
    throw new AppError('content-unavailable', response.message, response.message)
  }
  if (response.type !== 'PAGE_CONTENT') {
    throw new AppError('content-unavailable', 'Unexpected response from the page.')
  }
  return response.page
}

/* ------------------------------------------------------------------ */

/* API key test                                                        */
/* ------------------------------------------------------------------ */


function isRuntimeMessage(message: unknown): message is RuntimeMessage {
  if (typeof message !== 'object' || message === null) return false
  const record = message as Record<string, unknown>
  if (record['type'] === 'LIST_LOCAL_MODELS') return true
  return (
    record['type'] === 'TEST_KEY' &&
    typeof record['apiKey'] === 'string' &&
    typeof record['useLocal'] === 'boolean' &&
    typeof record['localModel'] === 'string'
  )
}

async function testApiKey(message: RuntimeMessage): Promise<TestKeyResult> {
  if (message.type !== 'TEST_KEY') {
    return { ok: false, error: { code: 'bad-request' } }
  }

  const apiKey = message.apiKey.trim()

  // The local server needs no key: proving it is up and serving the chosen
  // model is the whole test. The panel sends its current (possibly unsaved)
  // toggle, so this reflects what the user sees.
  if (message.useLocal) {
    const models = await listLocalModels()
    if (models.length === 0) {
      return {
        ok: false,
        error: {
          code: 'network',
          detail:
            'The local model server is not running. Start llama-server with your model, then try again.',
        },
      }
    }
    const wanted = message.localModel.trim()
    if (wanted && !isLocalModelInstalled(wanted, models)) {
      return {
        ok: false,
        error: { code: 'model-not-found', detail: `That model is not loaded by the local server: ${wanted}` },
      }
    }
    return { ok: true }
  }

  if (!apiKey) return { ok: false, error: { code: 'missing-key' } }

  const providerId = getProviderIdFromKey(apiKey)
  const model = resolveModel(providerId, await getSettings())
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)

  try {
    await complete(
      {
        system: 'You are a connection test. Reply with exactly: OK',
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        model,
        apiKey,
        signal: controller.signal,
        maxTokens: 256,
        temperature: 0,
      },
      providerId,
    )
    return { ok: true }
  } catch (error) {
    const info = toErrorInfo(error)
    if (info.code === 'aborted') {
      return {
        ok: false,
        error: { code: 'network', detail: 'The test timed out after 30 seconds.' },
      }
    }
    return { ok: false, error: info }
  } finally {
    clearTimeout(timeout)
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isRuntimeMessage(message)) return false

  if (message.type === 'LIST_LOCAL_MODELS') {
    void listLocalModels()
      .then((models) => sendResponse({ models }))
      .catch(() => sendResponse({ models: [] }))
    return true
  }

  void testApiKey(message)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ ok: false, error: toErrorInfo(error) }))

  return true
})

/* ------------------------------------------------------------------ */

/* Tab lifecycle                                                       */
/* ------------------------------------------------------------------ */


chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url === undefined) return

  void dropChatIfStale(tabId, changeInfo.url)
  void clearPendingSelection(tabId)

  // Stop answers that belong to the page the tab just left.
  for (const streams of streamsByPort.values()) {
    for (const stream of streams.values()) {
      if (stream.tabId === tabId) stream.controller.abort()
    }
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  void removeTabState(tabId)
  for (const streams of streamsByPort.values()) {
    for (const stream of streams.values()) {
      if (stream.tabId === tabId) stream.controller.abort()
    }
  }
})
