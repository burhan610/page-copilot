import {
  DEFAULT_SETTINGS,
  type ChatMessage,
  type PendingSelection,
  type Settings,
  type StoredChat,
  type SummaryLength,
} from '../types'

/* ------------------------------------------------------------------ */
/* Settings (sync) and API key (local only)                            */
/* ------------------------------------------------------------------ */

const SETTINGS_KEY = 'settings'
const API_KEY_KEY = 'apiKey'
const CHAT_PREFIX = 'chat:'
const PENDING_PREFIX = 'pendingSelection:'
const PENDING_TTL_MS = 2 * 60 * 1000
const MAX_STORED_MESSAGES = 200

const chatKey = (tabId: number) => `${CHAT_PREFIX}${tabId}`
const pendingKey = (tabId: number) => `${PENDING_PREFIX}${tabId}`

function isSummaryLength(value: unknown): value is SummaryLength {
  return value === 'short' || value === 'medium' || value === 'detailed'
}

function normalizeSettings(value: unknown): Settings {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_SETTINGS }
  const record = value as Record<string, unknown>

  const language =
    typeof record.language === 'string' && record.language.trim()
      ? record.language.trim()
      : DEFAULT_SETTINGS.language
  const summaryLength = isSummaryLength(record.summaryLength)
    ? record.summaryLength
    : DEFAULT_SETTINGS.summaryLength
  // Settings saved by the Ollama build used useOllama/ollamaModel; carry the
  // toggle over so the local mode stays on. A saved Ollama model name is only
  // kept when it was custom: the shipped default no longer exists locally.
  const legacyOllamaModel =
    typeof record.ollamaModel === 'string' ? record.ollamaModel.trim() : ''
  const useLocal =
    typeof record.useLocal === 'boolean' ? record.useLocal : record.useOllama === true
  const localModel =
    typeof record.localModel === 'string' && record.localModel.trim()
      ? record.localModel.trim()
      : legacyOllamaModel && legacyOllamaModel !== 'qwen3.5:0.8b'
        ? legacyOllamaModel
        : DEFAULT_SETTINGS.localModel

  return { language, summaryLength, useLocal, localModel }
}

export async function getSettings(): Promise<Settings> {
  try {
    const stored = await chrome.storage.sync.get(SETTINGS_KEY)
    return normalizeSettings(stored[SETTINGS_KEY])
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ [SETTINGS_KEY]: normalizeSettings(settings) })
}

export async function getApiKey(): Promise<string> {
  try {
    const stored = await chrome.storage.local.get(API_KEY_KEY)
    const value = stored[API_KEY_KEY]
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

export async function saveApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim()
  if (trimmed) await chrome.storage.local.set({ [API_KEY_KEY]: trimmed })
  else await chrome.storage.local.remove(API_KEY_KEY)
}

/** Re-reads settings whenever either the synced settings or the local key change. */
export function subscribeSettings(
  listener: (settings: Settings, apiKey: string) => void,
): () => void {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ): void => {
    const settingsChanged = areaName === 'sync' && SETTINGS_KEY in changes
    const keyChanged = areaName === 'local' && API_KEY_KEY in changes
    if (!settingsChanged && !keyChanged) return

    void Promise.all([getSettings(), getApiKey()]).then(([settings, apiKey]) => {
      listener(settings, apiKey)
    })
  }

  chrome.storage.onChanged.addListener(handler)
  return () => chrome.storage.onChanged.removeListener(handler)
}

/* ------------------------------------------------------------------ */
/* Per-tab chat history (session storage)                              */
/* ------------------------------------------------------------------ */

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    (record.role === 'user' || record.role === 'assistant') &&
    typeof record.content === 'string' &&
    typeof record.createdAt === 'number'
  )
}

export async function loadChat(tabId: number, url: string): Promise<ChatMessage[]> {
  try {
    const key = chatKey(tabId)
    const stored = await chrome.storage.session.get(key)
    const chat = stored[key] as StoredChat | undefined

    if (!chat || chat.url !== url || !Array.isArray(chat.messages)) {
      if (chat) await chrome.storage.session.remove(key)
      return []
    }

    return chat.messages.filter(isChatMessage).map((message) =>
      message.status === 'streaming' ? { ...message, status: 'stopped' } : message,
    )
  } catch {
    return []
  }
}

export async function saveChat(
  tabId: number,
  url: string,
  messages: ChatMessage[],
): Promise<void> {
  try {
    const key = chatKey(tabId)
    if (messages.length === 0) {
      await chrome.storage.session.remove(key)
      return
    }

    const chat: StoredChat = {
      tabId,
      url,
      messages: messages.slice(-MAX_STORED_MESSAGES),
      updatedAt: Date.now(),
    }
    await chrome.storage.session.set({ [key]: chat })
  } catch {
    /* session storage is best-effort; losing history must never break chat */
  }
}

export async function clearChat(tabId: number): Promise<void> {
  try {
    await chrome.storage.session.remove(chatKey(tabId))
  } catch {
    /* ignore */
  }
}

/** Removes a tab's history after it navigated somewhere else. */
export async function dropChatIfStale(tabId: number, currentUrl: string): Promise<void> {
  try {
    const key = chatKey(tabId)
    const stored = await chrome.storage.session.get(key)
    const chat = stored[key] as StoredChat | undefined
    if (chat && chat.url !== currentUrl) await chrome.storage.session.remove(key)
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Selection actions queued by the context menu                        */
/* ------------------------------------------------------------------ */

export async function savePendingSelection(pending: PendingSelection): Promise<void> {
  try {
    await chrome.storage.session.set({ [pendingKey(pending.tabId)]: pending })
  } catch {
    /* ignore */
  }
}

export async function peekPendingSelection(tabId: number): Promise<PendingSelection | null> {
  try {
    const key = pendingKey(tabId)
    const stored = await chrome.storage.session.get(key)
    const pending = stored[key] as PendingSelection | undefined

    if (
      !pending ||
      typeof pending.id !== 'string' ||
      typeof pending.text !== 'string' ||
      typeof pending.createdAt !== 'number'
    ) {
      return null
    }

    if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
      await chrome.storage.session.remove(key)
      return null
    }

    return pending
  } catch {
    return null
  }
}

/** Clears the pending action, optionally only when it is still the one with `id`. */
export async function clearPendingSelection(tabId: number, id?: string): Promise<void> {
  try {
    if (id) {
      const current = await peekPendingSelection(tabId)
      if (current && current.id !== id) return
    }
    await chrome.storage.session.remove(pendingKey(tabId))
  } catch {
    /* ignore */
  }
}

export async function removeTabState(tabId: number): Promise<void> {
  try {
    await chrome.storage.session.remove([chatKey(tabId), pendingKey(tabId)])
  } catch {
    /* ignore */
  }
}
