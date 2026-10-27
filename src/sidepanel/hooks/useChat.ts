import { useCallback, useEffect, useRef, useState } from 'react'
import { isRestrictedUrl } from '../../lib/extract'
import { connectToBackground } from '../../lib/messaging'
import {
  clearChat,
  clearPendingSelection,
  loadChat,
  peekPendingSelection,
  saveChat,
} from '../../lib/storage'
import type {
  ActionKind,
  BackgroundEvent,
  ChatMessage,
  ChatMessageStatus,
  ChatTurn,
  ErrorInfo,
  PendingSelection,
  UiRequest,
} from '../../types'

export interface SendOptions {
  question?: string
  selection?: string
  displayText?: string
}

export interface ChatController {
  messages: ChatMessage[]
  isStreaming: boolean
  isStopping: boolean
  progress: string | null
  error: ErrorInfo | null
  loaded: boolean
  send: (action: ActionKind, options?: SendOptions) => void
  stop: () => void
  clear: () => void
  dismissError: () => void
}

interface UseChatOptions {
  tab: chrome.tabs.Tab | null
  language: string
}

interface ActiveRequest {
  requestId: string
  assistantId: string
}

function shorten(text: string, max = 240): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

function displayTextFor(
  action: ActionKind,
  options: SendOptions,
  language: string,
): string {
  const quote = options.selection ? shorten(options.selection) : ''

  switch (action) {
    case 'summarize':
      return 'Summarize this page'
    case 'key-points':
      return 'List the key points'
    case 'eli5':
      return 'Explain this page simply'
    case 'translate':
      return `Translate this page to ${language}`
    case 'ask':
      return options.question?.trim() || 'Question about this page'
    case 'explain-selection':
      return quote ? `Explain this selected text:\n\n“${quote}”` : 'Explain the selected text'
    case 'translate-selection':
      return quote
        ? `Translate this selected text to ${language}:\n\n“${quote}”`
        : `Translate the selected text to ${language}`
  }
}

function buildHistory(messages: ChatMessage[]): ChatTurn[] {
  return messages
    .filter((message) => message.status !== 'streaming' && message.content.trim().length > 0)
    .slice(-10)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 4_000),
    }))
}

function postToPort(port: chrome.runtime.Port, message: UiRequest): boolean {
  try {
    port.postMessage(message)
    return true
  } catch {
    return false
  }
}

export function useChat({ tab, language }: UseChatOptions): ChatController {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<ErrorInfo | null>(null)
  const [loaded, setLoaded] = useState(false)

  const tabRef = useRef<chrome.tabs.Tab | null>(tab)
  const chatTabRef = useRef<{ id: number; url: string } | null>(null)
  const messagesRef = useRef<ChatMessage[]>([])
  const activeRef = useRef<ActiveRequest | null>(null)
  const portRef = useRef<chrome.runtime.Port | null>(null)
  const loadedRef = useRef(false)
  const handledPendingRef = useRef(new Set<string>())
  const languageRef = useRef(language)
  const sendRef = useRef<(action: ActionKind, options?: SendOptions) => void>(() => {})
  const handleSelectionRef = useRef<(pending: PendingSelection) => void>(() => {})

  useEffect(() => {
    languageRef.current = language
  }, [language])

  const finalize = useCallback(
    (requestId: string, status: ChatMessageStatus, nextError?: ErrorInfo): void => {
      const active = activeRef.current
      if (!active || active.requestId !== requestId) return

      activeRef.current = null
      setIsStreaming(false)
      setIsStopping(false)
      setProgress(null)
      if (nextError) setError(nextError)

      setMessages((previous) =>
        previous.map((message) =>
          message.id === active.assistantId
            ? { ...message, status, ...(nextError ? { error: nextError } : {}) }
            : message,
        ),
      )
    },
    [],
  )

  const handleEvent = useCallback(
    (event: BackgroundEvent): void => {
      if (event.type === 'SELECTION_ACTION') {
        handleSelectionRef.current(event.pending)
        return
      }

      const active = activeRef.current
      if (!active || event.requestId !== active.requestId) return

      switch (event.type) {
        case 'STREAM_CHUNK':
          setProgress(null)
          setMessages((previous) =>
            previous.map((message) =>
              message.id === active.assistantId
                ? { ...message, content: message.content + event.text }
                : message,
            ),
          )
          break
        case 'STREAM_PROGRESS':
          setProgress(event.message)
          break
        case 'STREAM_DONE':
          finalize(event.requestId, event.stopped ? 'stopped' : 'done')
          break
        case 'STREAM_ERROR':
          finalize(event.requestId, 'error', event.error)
          break
      }
    },
    [finalize],
  )

  const connect = useCallback((): chrome.runtime.Port => {
    const existing = portRef.current
    if (existing) return existing

    const port = connectToBackground()
    portRef.current = port

    port.onMessage.addListener((event: BackgroundEvent) => handleEvent(event))
    port.onDisconnect.addListener(() => {
      if (portRef.current === port) portRef.current = null
      const active = activeRef.current
      if (active) {
        finalize(active.requestId, 'error', {
          code: 'network',
          detail:
            'Lost the connection to the extension background. Reopen the side panel and try again.',
        })
      }
    })

    const tabId = tabRef.current?.id
    if (tabId !== undefined) postToPort(port, { type: 'HELLO', tabId })
    return port
  }, [handleEvent, finalize])

  const send = useCallback(
    (action: ActionKind, options: SendOptions = {}): void => {
      if (activeRef.current) return

      const currentTab = tabRef.current
      if (!currentTab?.id) {
        setError({ code: 'tab-closed', detail: 'Open a web page first.' })
        return
      }

      const restricted = isRestrictedUrl(currentTab.url)
      if (restricted) {
        setError({ code: 'restricted-page', detail: restricted.message })
        return
      }

      const requestId = crypto.randomUUID()
      const now = Date.now()
      const history = buildHistory(messages)

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: options.displayText?.trim() || displayTextFor(action, options, languageRef.current),
        status: 'done',
        createdAt: now,
        action,
      }
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        status: 'streaming',
        createdAt: now + 1,
        action,
      }

      activeRef.current = { requestId, assistantId: assistantMessage.id }
      setError(null)
      setProgress(null)
      setIsStopping(false)
      setIsStreaming(true)
      setMessages((previous) => [...previous, userMessage, assistantMessage])

      const port = connect()
      const sent = postToPort(port, {
        type: 'RUN_ACTION',
        requestId,
        tabId: currentTab.id,
        action,
        ...(options.question ? { question: options.question } : {}),
        ...(options.selection ? { selection: options.selection } : {}),
        history,
      })

      if (!sent) {
        finalize(requestId, 'error', {
          code: 'network',
          detail: 'Could not start the request. Close and reopen the side panel and try again.',
        })
      }
    },
    [connect, finalize, messages],
  )

  const stop = useCallback((): void => {
    const active = activeRef.current
    if (!active) return

    setIsStopping(true)
    const port = portRef.current
    if (!port || !postToPort(port, { type: 'STOP_STREAM', requestId: active.requestId })) {
      finalize(active.requestId, 'stopped')
      return
    }

    // Safety net: never leave the composer stuck if the worker disappears.
    window.setTimeout(() => {
      if (activeRef.current?.requestId === active.requestId) {
        finalize(active.requestId, 'stopped')
      }
    }, 4_000)
  }, [finalize])

  const clear = useCallback((): void => {
    const active = activeRef.current
    if (active) {
      const port = portRef.current
      if (port) postToPort(port, { type: 'STOP_STREAM', requestId: active.requestId })
      activeRef.current = null
    }

    setIsStreaming(false)
    setIsStopping(false)
    setProgress(null)
    setError(null)
    setMessages([])
    messagesRef.current = []

    const current = chatTabRef.current
    if (current) void clearChat(current.id)
  }, [])

  const dismissError = useCallback((): void => setError(null), [])

  const handleSelection = useCallback((pending: PendingSelection): void => {
    const currentTab = tabRef.current
    if (!currentTab?.id || pending.tabId !== currentTab.id) return
    if (handledPendingRef.current.has(pending.id)) return
    handledPendingRef.current.add(pending.id)

    void clearPendingSelection(pending.tabId, pending.id)
    sendRef.current(pending.action, {
      selection: pending.text,
      displayText: displayTextFor(pending.action, { selection: pending.text }, languageRef.current),
    })
  }, [])

  useEffect(() => {
    sendRef.current = send
    handleSelectionRef.current = handleSelection
  }, [send, handleSelection])

  // Keep the live tab object available to callbacks without reloading on
  // irrelevant updates such as title or favicon changes.
  useEffect(() => {
    tabRef.current = tab ?? null
  }, [tab])

  // Track the tab whose messages are on screen and load its history.
  useEffect(() => {
    const tabId = tab?.id
    const url = tab?.url ?? ''
    const previous = chatTabRef.current

    if (previous && (previous.id !== tabId || previous.url !== url)) {
      void saveChat(previous.id, previous.url, messagesRef.current)
    }

    const active = activeRef.current
    if (active) {
      const port = portRef.current
      if (port) postToPort(port, { type: 'STOP_STREAM', requestId: active.requestId })
      activeRef.current = null
      setIsStreaming(false)
      setIsStopping(false)
      setProgress(null)
    }

    chatTabRef.current = null
    loadedRef.current = false
    setLoaded(false)
    setMessages([])
    messagesRef.current = []
    setError(null)

    if (tabId === undefined) {
      setLoaded(true)
      return
    }

    chatTabRef.current = { id: tabId, url }
    let cancelled = false

    void loadChat(tabId, url)
      .then((stored) => {
        if (cancelled) return
        messagesRef.current = stored
        setMessages(stored)
        loadedRef.current = true
        setLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        loadedRef.current = true
        setLoaded(true)
      })

    return () => {
      cancelled = true
    }
    // The tab object changes on every title update; only id/url should reload.
  }, [tab?.id, tab?.url])

  // Queue a selection action that arrived before the panel connected.
  useEffect(() => {
    const tabId = tab?.id
    if (tabId === undefined) return

    const port = connect()
    postToPort(port, { type: 'HELLO', tabId })

    const timer = window.setTimeout(() => {
      void peekPendingSelection(tabId).then((pending) => {
        if (pending) handleSelectionRef.current(pending)
      })
    }, 400)

    return () => window.clearTimeout(timer)
  }, [tab?.id, connect])

  // Persist history (debounced) so closing the panel or switching tabs is safe.
  useEffect(() => {
    messagesRef.current = messages
    if (!loadedRef.current) return

    const current = chatTabRef.current
    if (!current) return

    const timer = window.setTimeout(() => {
      void saveChat(current.id, current.url, messages)
    }, 400)

    return () => window.clearTimeout(timer)
  }, [messages, loaded])

  useEffect(() => {
    return () => {
      const current = chatTabRef.current
      if (current && messagesRef.current.length > 0) {
        void saveChat(current.id, current.url, messagesRef.current)
      }
    }
  }, [])

  return {
    messages,
    isStreaming,
    isStopping,
    progress,
    error,
    loaded,
    send,
    stop,
    clear,
    dismissError,
  }
}
