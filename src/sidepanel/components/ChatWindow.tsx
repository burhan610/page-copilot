import { useEffect, useRef } from 'react'
import type { ChatMessage, QuickAction, RestrictedPage } from '../../types'
import MessageBubble from './MessageBubble'

interface ChatWindowProps {
  messages: ChatMessage[]
  loaded: boolean
  settingsReady: boolean
  isStreaming: boolean
  progress: string | null
  hasApiKey: boolean
  tab: chrome.tabs.Tab | null
  restricted: RestrictedPage | null
  onOpenSettings: () => void
  onSuggestedAction: (action: QuickAction) => void
}

function LoadingState() {
  return (
    <div
      className="flex h-full flex-col gap-3 px-3 py-4"
      aria-busy="true"
      aria-label="Loading conversation"
    >
      <div className="ml-auto h-9 w-2/3 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
      <div className="h-24 w-5/6 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
      <div className="ml-auto h-9 w-1/2 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
    </div>
  )
}

function Onboarding({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-2 py-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-md">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          className="h-6 w-6"
        >
          <path
            d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4V5.5Z"
            strokeLinejoin="round"
          />
          <path d="M8 8.5h8M8 12h5" strokeLinecap="round" />
        </svg>
      </div>

      <h2 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
        Your copilot for this page
      </h2>
      <p className="mt-1 max-w-[28ch] text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        Add your API key to summarize the page, ask questions, explain a selection, or
        translate it.
      </p>

      <button
        type="button"
        onClick={onOpenSettings}
        className="mt-4 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-700"
      >
        Add your API key
      </button>

      <p className="mt-4 flex max-w-[32ch] items-start gap-1.5 text-left text-[10px] leading-snug text-slate-400 dark:text-slate-500">
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="mt-0.5 h-3 w-3 shrink-0"
        >
          <path
            fillRule="evenodd"
            d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a1.5 1.5 0 0 0-1.5 1.5v5A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 12 6h-.5V4.5A3.5 3.5 0 0 0 8 1Zm-2 5V4.5a2 2 0 1 1 4 0V6H6Z"
            clipRule="evenodd"
          />
        </svg>
        <span>
          The key stays in this browser. Page text is sent to the AI provider only when you run an action.
        </span>
      </p>
    </div>
  )
}

function EmptyState({
  hasApiKey,
  tab,
  restricted,
  onOpenSettings,
  onSuggestedAction,
}: Pick<
  ChatWindowProps,
  'hasApiKey' | 'tab' | 'restricted' | 'onOpenSettings' | 'onSuggestedAction'
>) {
  if (!tab) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 py-8 text-center">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          No page selected
        </h2>
        <p className="mt-1 max-w-[30ch] text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          Open a website tab and click the Page Copilot icon to start reading with AI.
        </p>
      </div>
    )
  }

  if (restricted) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 py-8 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            className="h-5 w-5"
          >
            <path
              d="M10 3 2.8 16h14.4L10 3Z"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <path d="M10 8v3.5M10 14.2v.1" strokeLinecap="round" />
          </svg>
        </div>
        <h2 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
          This page can't be read
        </h2>
        <p className="mt-1.5 max-w-[34ch] text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          {restricted.message}
        </p>
        <p className="mt-3 max-w-[34ch] text-[10px] leading-snug text-slate-400 dark:text-slate-500">
          Try a news article, documentation page, blog post, or any normal website.
        </p>
      </div>
    )
  }

  if (!hasApiKey) {
    return <Onboarding onOpenSettings={onOpenSettings} />
  }

  const suggestions: ReadonlyArray<{ action: QuickAction; label: string }> = [
    { action: 'summarize', label: 'Summarize this page' },
    { action: 'key-points', label: 'List the key points' },
    { action: 'eli5', label: 'Explain it like I’m five' },
  ]

  return (
    <div className="flex h-full flex-col items-center justify-center px-3 py-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          className="h-5 w-5"
        >
          <path
            d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 11l5.6-1.9L12 3.5Z"
            strokeLinejoin="round"
          />
          <path d="M18.5 15.5 19.3 18l2.2.8-2.2.8-.8 2.4-.8-2.4-2.2-.8 2.2-.8.8-2.5Z" />
        </svg>
      </div>
      <h2 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
        Ready when you are
      </h2>
      <p className="mt-1 max-w-[30ch] text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        Ask anything about this page, or start with one of these:
      </p>

      <div className="mt-4 flex w-full max-w-[280px] flex-col gap-1.5">
        {suggestions.map(({ action, label }) => (
          <button
            key={action}
            type="button"
            onClick={() => onSuggestedAction(action)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-xs font-medium text-slate-700 shadow-sm transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-brand-700 dark:hover:bg-brand-950/40 dark:hover:text-brand-200"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function ChatWindow({
  messages,
  loaded,
  settingsReady,
  isStreaming,
  progress,
  hasApiKey,
  tab,
  restricted,
  onOpenSettings,
  onSuggestedAction,
}: ChatWindowProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  useEffect(() => {
    const last = messages[messages.length - 1]
    if (last?.role === 'user') stickToBottomRef.current = true
    if (!stickToBottomRef.current) return

    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [messages, progress, loaded])

  const handleScroll = (): void => {
    const element = scrollRef.current
    if (!element) return
    stickToBottomRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 64
  }

  if (!loaded || !settingsReady) {
    return (
      <div className="h-full overflow-hidden">
        <LoadingState />
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="h-full overflow-y-auto scrollbar-thin px-3 py-3"
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
      aria-busy={isStreaming}
    >
      {messages.length === 0 ? (
        <EmptyState
          hasApiKey={hasApiKey}
          tab={tab}
          restricted={restricted}
          onOpenSettings={onOpenSettings}
          onSuggestedAction={onSuggestedAction}
        />
      ) : (
        <div className="flex flex-col gap-3 pb-1">
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              progress={message.status === 'streaming' ? progress : null}
            />
          ))}
        </div>
      )}
    </div>
  )
}
