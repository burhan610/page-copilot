/** Shared contracts between the side panel, service worker and content script. */

export type Role = 'user' | 'assistant'

export type SummaryLength = 'short' | 'medium' | 'detailed'

export interface Settings {
  /** Model name, e.g. "claude-3-opus-20240229". */
  model: string
  /** Language for answers and for the Translate action (display name). */
  language: string
  summaryLength: SummaryLength
}

export const DEFAULT_MODEL = 'gemini-2.5-flash'

export const DEFAULT_SETTINGS: Settings = {
  model: DEFAULT_MODEL,
  language: 'English',
  summaryLength: 'medium',
}

export const LANGUAGE_OPTIONS = [
  'English',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Dutch',
  'Polish',
  'Turkish',
  'Hindi',
  'Urdu',
  'Arabic',
  'Chinese (Simplified)',
  'Chinese (Traditional)',
  'Japanese',
  'Korean',
  'Russian',
  'Indonesian',
  'Vietnamese',
  'Thai',
] as const

export const SUMMARY_LENGTH_OPTIONS: ReadonlyArray<{
  value: SummaryLength
  label: string
  hint: string
}> = [
  { value: 'short', label: 'Short', hint: 'Quick gist, a few sentences' },
  { value: 'medium', label: 'Medium', hint: 'A couple of paragraphs' },
  { value: 'detailed', label: 'Detailed', hint: 'Thorough, structured notes' },
]

export type ExtractionMethod = 'readability' | 'body'

export interface PageContent {
  title: string
  url: string
  text: string
  wordCount: number
  lang: string
  extraction: ExtractionMethod
}

/** A page Chrome (or the extension) refuses to read. */
export interface RestrictedPage {
  reason: 'browser' | 'webstore' | 'pdf' | 'no-url'
  message: string
}

/** High-level action that can be run against the page or a selection. */
export type ActionKind =
  | 'summarize'
  | 'key-points'
  | 'eli5'
  | 'translate'
  | 'ask'
  | 'explain-selection'
  | 'translate-selection'

export type QuickAction = Extract<ActionKind, 'summarize' | 'key-points' | 'eli5' | 'translate'>

export type SelectionAction = Extract<ActionKind, 'explain-selection' | 'translate-selection'>

export type ErrorCode =
  | 'missing-key'
  | 'invalid-key'
  | 'rate-limit'
  | 'server'
  | 'network'
  | 'model-not-found'
  | 'bad-request'
  | 'empty-response'
  | 'aborted'
  | 'restricted-page'
  | 'empty-page'
  | 'no-selection'
  | 'tab-closed'
  | 'content-unavailable'
  | 'unknown'

export interface ErrorInfo {
  code: ErrorCode
  /** Optional technical detail, shown small under the friendly message. */
  detail?: string
}

/** Error with a machine-readable code that can cross extension boundaries. */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly detail?: string

  constructor(code: ErrorCode, message: string, detail?: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
    if (detail !== undefined) this.detail = detail
  }
}

export function toErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof AppError) {
    return error.detail ? { code: error.code, detail: error.detail } : { code: error.code }
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { code: 'aborted' }
  }
  if (error instanceof Error) {
    if (error.name === 'AbortError') return { code: 'aborted' }
    return { code: 'unknown', detail: error.message }
  }
  return { code: 'unknown' }
}

export type ChatMessageStatus = 'streaming' | 'done' | 'stopped' | 'error'

export interface ChatMessage {
  id: string
  role: Role
  content: string
  status: ChatMessageStatus
  createdAt: number
  action?: ActionKind
  error?: ErrorInfo
}

export interface ChatTurn {
  role: Role
  content: string
}

export interface StoredChat {
  tabId: number
  url: string
  messages: ChatMessage[]
  updatedAt: number
}

export interface PendingSelection {
  id: string
  tabId: number
  action: SelectionAction
  text: string
  pageTitle: string
  url: string
  createdAt: number
}

/** Messages sent to the content script. */
export type ContentRequest = { type: 'GET_PAGE_CONTENT' } | { type: 'GET_SELECTION' }

export type ContentResponse =
  | { type: 'PAGE_CONTENT'; page: PageContent }
  | { type: 'SELECTION'; text: string }
  | { type: 'CONTENT_ERROR'; message: string }

/** One-off messages to the service worker. */
export type RuntimeMessage = { type: 'TEST_KEY'; apiKey: string; model: string }

export interface TestKeyResult {
  ok: boolean
  error?: ErrorInfo
}

/** Messages sent from the side panel over a long-lived port. */
export type UiRequest =
  | { type: 'HELLO'; tabId: number }
  | {
      type: 'RUN_ACTION'
      requestId: string
      tabId: number
      action: ActionKind
      question?: string
      selection?: string
      history?: ChatTurn[]
    }
  | { type: 'STOP_STREAM'; requestId: string }

/** Messages streamed back from the service worker. */
export type BackgroundEvent =
  | { type: 'STREAM_CHUNK'; requestId: string; text: string }
  | { type: 'STREAM_PROGRESS'; requestId: string; message: string }
  | { type: 'STREAM_DONE'; requestId: string; stopped?: boolean }
  | { type: 'STREAM_ERROR'; requestId: string; error: ErrorInfo }
  | { type: 'SELECTION_ACTION'; pending: PendingSelection }

export const PORT_NAME = 'page-copilot-stream'
