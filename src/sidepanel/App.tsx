import { useEffect, useRef, useState, type RefObject } from 'react'
import type { QuickAction, RestrictedPage, Settings } from '../types'
import { useActiveTab } from './hooks/useActiveTab'
import { useChat } from './hooks/useChat'
import { useSettings } from './hooks/useSettings'
import ChatWindow from './components/ChatWindow'
import ErrorBanner from './components/ErrorBanner'
import QuickActions from './components/QuickActions'
import SettingsPanel from './components/SettingsPanel'

function BubbleIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4V5.5Z" />
      <path d="M8 8.5h8M8 12h5" />
    </svg>
  )
}

function GlobeIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      className={className}
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c1.8 1.7 2.8 3.8 2.8 6S9.8 12.3 8 14C6.2 12.3 5.2 10.2 5.2 8S6.2 3.7 8 2Z" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="h-4 w-4"
    >
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      className="h-4 w-4"
    >
      <path d="M3.5 5.5h13M8 3.5h4M5 5.5l.7 11h8.6l.7-11M8.3 9v4.5M11.7 9v4.5" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M10 15.5V5M6 8.5 10 4.5l4 4" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
      <rect x="4" y="4" width="8" height="8" rx="1.5" />
    </svg>
  )
}

interface HeaderProps {
  canClear: boolean
  onClear: () => void
  onOpenSettings: () => void
}

function Header({ canClear, onClear, onOpenSettings }: HeaderProps) {
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm">
        <BubbleIcon />
      </div>

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
          Page Copilot
        </h1>
        <p className="truncate text-[10px] text-slate-400 dark:text-slate-500">
          AI reading assistant
        </p>
      </div>

      <button
        type="button"
        onClick={onClear}
        disabled={!canClear}
        aria-label="Clear chat"
        title="Clear chat"
        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        <TrashIcon />
      </button>

      <button
        type="button"
        onClick={onOpenSettings}
        aria-label="Open settings"
        title="Settings"
        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        <SettingsIcon />
      </button>
    </header>
  )
}

function PageContext({
  tab,
  restricted,
}: {
  tab: chrome.tabs.Tab | null
  restricted: RestrictedPage | null
}) {
  const [faviconFailed, setFaviconFailed] = useState(false)

  useEffect(() => {
    setFaviconFailed(false)
  }, [tab?.favIconUrl])

  let hostname = ''
  try {
    hostname = tab?.url ? new URL(tab.url).hostname : ''
  } catch {
    hostname = ''
  }

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white/70 px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900/50">
      {tab?.favIconUrl && !faviconFailed ? (
        <img
          src={tab.favIconUrl}
          alt=""
          aria-hidden="true"
          referrerPolicy="no-referrer"
          onError={() => setFaviconFailed(true)}
          className="h-4 w-4 shrink-0 rounded-sm"
        />
      ) : (
        <GlobeIcon className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
      )}

      <div className="min-w-0 flex-1">
        <p
          className="truncate text-xs font-medium text-slate-700 dark:text-slate-200"
          title={tab?.title ?? undefined}
        >
          {tab ? tab.title || 'Untitled page' : 'No page selected'}
        </p>
        <p className="truncate text-[10px] text-slate-400 dark:text-slate-500">
          {restricted
            ? 'Chrome does not allow extensions to read this page'
            : hostname || 'Open a website to use Page Copilot'}
        </p>
      </div>

      {restricted && (
        <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
          Restricted
        </span>
      )}
    </div>
  )
}

interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  isStreaming: boolean
  isStopping: boolean
  disabled: boolean
  placeholder: string
  textareaRef: RefObject<HTMLTextAreaElement>
}

function Composer({
  value,
  onChange,
  onSend,
  onStop,
  isStreaming,
  isStopping,
  disabled,
  placeholder,
  textareaRef,
}: ComposerProps) {
  return (
    <div className="mt-2">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onSend()
        }}
      >
        <div className="flex items-end gap-1.5 rounded-xl border border-slate-300 bg-white p-1 shadow-sm transition-colors focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-900">
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                if (!disabled) onSend()
              }
            }}
            placeholder={placeholder}
            aria-label="Ask about this page"
            className="max-h-28 min-h-[36px] w-full resize-none bg-transparent px-2 py-2 text-sm leading-snug text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed dark:text-slate-100"
          />

          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              disabled={isStopping}
              aria-label="Stop generating"
              className="mb-0.5 flex shrink-0 items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-900 disabled:opacity-60 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white"
            >
              <StopIcon />
              <span>{isStopping ? 'Stopping…' : 'Stop'}</span>
            </button>
          ) : (
            <button
              type="submit"
              disabled={disabled || !value.trim()}
              aria-label="Send message"
              title="Send"
              className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-600"
            >
              <SendIcon />
            </button>
          )}
        </div>
      </form>

      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 px-0.5 text-[10px] text-slate-400 dark:text-slate-500">
        <span>Enter to send · Shift+Enter for a new line</span>
        <span>Sent to AI provider only when you run an action</span>
      </div>
    </div>
  )
}

export default function App() {
  const { tab, restricted, loading: tabLoading } = useActiveTab()
  const {
    settings,
    apiKey,
    hasApiKey,
    loading: settingsLoading,
    save,
  } = useSettings()
  const chat = useChat({ tab, language: settings.language })

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 112)}px`
  }, [draft])

  const openSettings = (): void => setSettingsOpen(true)

  const handleQuickAction = (action: QuickAction): void => {
    if (!hasApiKey) {
      openSettings()
      return
    }
    chat.send(action)
  }

  const handleAsk = (): void => {
    if (!hasApiKey) {
      openSettings()
      return
    }
    if (chat.isStreaming) return

    const question = draft.trim()
    if (!question) return

    chat.send('ask', { question, displayText: question })
    setDraft('')
  }

  const handleSaveSettings = async (nextSettings: Settings, nextKey: string): Promise<void> => {
    await save(nextSettings, nextKey)
    chat.dismissError()
  }

  const settingsReady = !settingsLoading && !tabLoading
  const pageUnavailable = Boolean(restricted) || !tab
  const composerDisabled = !hasApiKey || pageUnavailable || settingsLoading

  const placeholder = !tab
    ? 'Open a website tab to get started'
    : restricted
      ? "This page can't be read"
      : !hasApiKey
        ? 'Add your API key in Settings to start'
        : 'Ask anything about this page…'

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50 dark:bg-slate-950">
      <Header
        canClear={chat.messages.length > 0 || chat.isStreaming}
        onClear={() => {
          chat.clear()
          setDraft('')
        }}
        onOpenSettings={openSettings}
      />

      <PageContext tab={tab} restricted={restricted} />

      {chat.error && (
        <ErrorBanner
          error={chat.error}
          onDismiss={chat.dismissError}
          onOpenSettings={openSettings}
        />
      )}

      <main className="min-h-0 flex-1">
        <ChatWindow
          messages={chat.messages}
          loaded={chat.loaded}
          settingsReady={settingsReady}
          isStreaming={chat.isStreaming}
          progress={chat.progress}
          hasApiKey={hasApiKey}
          tab={tab}
          restricted={restricted}
          onOpenSettings={openSettings}
          onSuggestedAction={handleQuickAction}
        />
      </main>

      <footer className="shrink-0 border-t border-slate-200 bg-white px-3 pb-2.5 pt-2 dark:border-slate-800 dark:bg-slate-950">
        <QuickActions
          disabled={chat.isStreaming || pageUnavailable || !settingsReady}
          language={settings.language}
          onAction={handleQuickAction}
        />

        <Composer
          value={draft}
          onChange={setDraft}
          onSend={handleAsk}
          onStop={chat.stop}
          isStreaming={chat.isStreaming}
          isStopping={chat.isStopping}
          disabled={composerDisabled}
          placeholder={placeholder}
          textareaRef={textareaRef}
        />
      </footer>

      <SettingsPanel
        open={settingsOpen}
        settings={settings}
        apiKey={apiKey}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveSettings}
      />
    </div>
  )
}
