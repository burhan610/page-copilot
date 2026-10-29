import type { ErrorInfo } from '../../types'

export interface ErrorCopy {
  title: string
  message: string
  detail?: string
  openSettings?: boolean
}

export function getErrorCopy(error: ErrorInfo): ErrorCopy {
  const detail = error.detail?.trim() || undefined

  switch (error.code) {
    case 'missing-key':
      return {
        title: 'Add your API key',
        message: 'Page Copilot needs an API key before it can read this page.',
        openSettings: true,
      }
    case 'invalid-key':
      return {
        title: 'Your API key was rejected',
        message: 'Check that the key is valid and can access the selected model.',
        detail,
        openSettings: true,
      }
    case 'rate-limit':
      return {
        title: 'Rate limit reached',
        message: 'The AI provider is limiting requests for this key. Wait a moment and try again.',
        detail,
      }
    case 'server':
      return {
        title: 'The AI service had a problem',
        message: 'The AI provider returned a server error or is overloaded. Try again in a moment.',
        detail,
      }
    case 'network':
      return {
        title: "Couldn't reach the AI service",
        message: 'Check your connection, or start the local model server, then try again.',
        detail,
      }
    case 'model-not-found':
      return {
        title: 'Model not available',
        message: 'The model in Settings is not available. Pick one in Settings.',
        detail,
        openSettings: true,
      }
    case 'bad-request':
      return {
        title: 'The request was rejected',
        message: 'Check the model name in Settings, or try a shorter page or selection.',
        detail,
        openSettings: true,
      }
    case 'empty-response':
      return {
        title: 'The model returned nothing',
        message: 'Try again, or choose a different model in Settings.',
        openSettings: true,
      }
    case 'restricted-page':
      return {
        title: "This page can't be read",
        message:
          detail ??
          "Chrome doesn't let extensions read this page. Open a normal website to use Page Copilot.",
      }
    case 'empty-page':
      return {
        title: 'No readable text found',
        message:
          detail ?? 'This page has no readable article text. Try a different page or selection.',
      }
    case 'no-selection':
      return {
        title: 'No text selected',
        message: detail ?? 'Select some text on the page, then use the right-click menu.',
      }
    case 'tab-closed':
      return {
        title: 'That tab is gone',
        message: detail ?? 'Open the page again and try once more.',
      }
    case 'content-unavailable':
      return {
        title: "Couldn't read this page",
        message:
          detail ??
          'The page blocked access or is still loading. Reload it and try again in a moment.',
      }
    case 'aborted':
      return {
        title: 'Stopped',
        message: 'The response was stopped.',
      }
    case 'unknown':
      return {
        title: 'Something went wrong',
        message: detail ?? 'An unexpected error occurred. Try again.',
      }
  }
}

interface ErrorBannerProps {
  error: ErrorInfo
  onDismiss?: () => void
  onOpenSettings?: () => void
  compact?: boolean
}

export default function ErrorBanner({
  error,
  onDismiss,
  onOpenSettings,
  compact = false,
}: ErrorBannerProps) {
  const copy = getErrorCopy(error)
  const showDetail = copy.detail && copy.detail !== copy.message

  return (
    <div
      role="alert"
      className={[
        'rounded-xl border border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-100',
        compact ? 'p-2' : 'mx-3 mt-2 p-2.5',
      ].join(' ')}
    >
      <div className="flex items-start gap-2">
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="mt-0.5 h-4 w-4 shrink-0 text-rose-500 dark:text-rose-400"
        >
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm0-11.5a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-1.5 0v-4A.75.75 0 0 1 10 6.5Zm0 7.25a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
            clipRule="evenodd"
          />
        </svg>

        <div className="min-w-0 flex-1">
          <p className={compact ? 'text-xs font-semibold' : 'text-sm font-semibold'}>
            {copy.title}
          </p>
          <p className="mt-0.5 text-xs leading-snug opacity-90">{copy.message}</p>
          {showDetail && (
            <p className="mt-1 break-words text-[11px] leading-snug opacity-70">{copy.detail}</p>
          )}

          {copy.openSettings && onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="mt-2 rounded-md bg-rose-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-rose-700 focus-visible:ring-rose-400 focus-visible:ring-offset-rose-50 dark:focus-visible:ring-offset-rose-950"
            >
              Open settings
            </button>
          )}
        </div>

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss error"
            className="shrink-0 rounded p-0.5 text-rose-500 hover:bg-rose-100 hover:text-rose-700 dark:hover:bg-rose-900/50 dark:hover:text-rose-200"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M4.28 3.22a.75.75 0 0 0-1.06 1.06L6.94 8l-3.72 3.72a.75.75 0 1 0 1.06 1.06L8 9.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L9.06 8l3.72-3.72a.75.75 0 0 0-1.06-1.06L8 6.94 4.28 3.22Z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
