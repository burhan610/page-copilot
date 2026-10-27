import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '../../types'
import ErrorBanner from './ErrorBanner'

interface MessageBubbleProps {
  message: ChatMessage
  progress?: string | null
}

function TypingDots() {
  return (
    <span className="flex items-center gap-1 py-1" role="status" aria-label="Assistant is writing">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 dark:bg-slate-500"
          style={{ animationDelay: `${index * 120}ms` }}
        />
      ))}
    </span>
  )
}

function Spinner() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-3 w-3 animate-spin"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="M12 3a9 9 0 1 0 9 9" strokeLinecap="round" />
    </svg>
  )
}

export default function MessageBubble({ message, progress }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false)
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-brand-600 px-3 py-2 text-sm leading-relaxed text-white shadow-sm">
          {message.content}
        </div>
      </div>
    )
  }

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="max-w-[96%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {message.content ? (
          <div className="markdown">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ node: _node, ...props }) => (
                  <a {...props} target="_blank" rel="noopener noreferrer" />
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        ) : message.status === 'streaming' ? (
          <TypingDots />
        ) : null}

        {message.status === 'streaming' && message.content && (
          <span
            aria-hidden="true"
            className="mt-0.5 inline-block h-4 w-1 animate-pulse rounded-sm bg-brand-500 align-middle"
          />
        )}

        {message.status === 'streaming' && progress && (
          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <Spinner />
            <span>{progress}</span>
          </p>
        )}

        {message.status === 'stopped' && (
          <p className="mt-1.5 text-[11px] italic text-slate-500 dark:text-slate-400">
            {message.content ? 'Stopped.' : 'Stopped before any text arrived.'}
          </p>
        )}

        {message.status === 'error' && message.error && (
          <div className="mt-2">
            <ErrorBanner error={message.error} compact />
          </div>
        )}
      </div>

      {message.content.trim().length > 0 && (
        <button
          type="button"
          onClick={() => void copy()}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          aria-label={copied ? 'Copied to clipboard' : 'Copy message'}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            className="h-3 w-3"
          >
            <rect x="7" y="7" width="9" height="9" rx="1.5" />
            <path d="M13 5.5A1.5 1.5 0 0 0 11.5 4h-7A1.5 1.5 0 0 0 3 5.5v7A1.5 1.5 0 0 0 4.5 14" />
          </svg>
          {copied ? 'Copied' : 'Copy'}
        </button>
      )}
    </div>
  )
}
