import { AppError, DEFAULT_MODEL } from '../types'

export interface LLMMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface StreamCompletionParams {
  system: string
  messages: LLMMessage[]
  model: string
  apiKey: string
  signal?: AbortSignal
  maxTokens?: number
  temperature?: number
  onChunk: (text: string) => void
}

export type CompletionParams = Omit<StreamCompletionParams, 'onChunk'>

/** Swap this implementation to support another vendor later. */
export interface LLMProvider {
  readonly id: string
  readonly label: string
  streamCompletion(params: StreamCompletionParams): Promise<void>
}

export const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta'

export const DEFAULT_MAX_TOKENS = 4096

/** Model names this extension used in earlier releases. Google retired them, so
 *  they are mapped to the current default instead of failing with 404. */
const LEGACY_MODEL_ALIASES = new Set(['gemini', 'gemini api', 'gemini-pro', 'gemini pro'])

function abortError(): AppError {
  return new AppError('aborted', 'The request was stopped.')
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Google returns 400 INVALID_ARGUMENT for a bad key, so match on the message too. */
function isApiKeyMessage(message: string): boolean {
  return (
    /api[_ ]key/i.test(message) && /(not valid|invalid|denied|rejected|missing)/i.test(message)
  )
}

/** Maps a Google RPC error status (INVALID_ARGUMENT, NOT_FOUND, ...) to an AppError. */
function mapGoogleStatus(status: string | undefined, message: string | undefined): AppError | null {
  const detail = message
  if (message && isApiKeyMessage(message)) {
    return new AppError('invalid-key', 'The API key was rejected.', detail)
  }
  switch (status) {
    case 'UNAUTHENTICATED':
    case 'PERMISSION_DENIED':
      return new AppError('invalid-key', 'The API key was rejected.', detail)
    case 'RESOURCE_EXHAUSTED':
      return new AppError('rate-limit', 'The API rate limit was reached.', detail)
    case 'NOT_FOUND':
      return new AppError('model-not-found', 'The requested model was not found.', detail)
    case 'INVALID_ARGUMENT':
      return new AppError('bad-request', 'The AI provider rejected the request.', detail)
    case 'UNAVAILABLE':
    case 'INTERNAL':
    case 'DEADLINE_EXCEEDED':
      return new AppError('server', 'The AI provider had a server error.', detail)
    default:
      return null
  }
}

/* ------------------------------------------------------------------ */
/* SSE parsing                                                         */
/* ------------------------------------------------------------------ */

export interface SSEEvent {
  event?: string
  data: string
}

export interface SSEParser {
  feed(chunk: string): void
  end(): void
}

/** Incremental server-sent-events parser. Exported so the stream format can be tested without a network connection. */
export function createSSEParser(onEvent: (event: SSEEvent) => void): SSEParser {
  let buffer = ''

  const dispatch = (raw: string) => {
    let eventName: string | undefined
    const dataLines: string[] = []

    for (const line of raw.replace(/\r/g, '').split('\n')) {
      if (!line || line.startsWith(':')) continue
      const colon = line.indexOf(':')
      const field = colon === -1 ? line : line.slice(0, colon)
      let value = colon === -1 ? '' : line.slice(colon + 1)
      if (value.startsWith(' ')) value = value.slice(1)

      if (field === 'event') eventName = value
      else if (field === 'data') dataLines.push(value)
    }

    if (dataLines.length > 0) {
      onEvent(
        eventName === undefined
          ? { data: dataLines.join('\n') }
          : { event: eventName, data: dataLines.join('\n') },
      )
    }
  }

  return {
    feed(chunk: string) {
      buffer += chunk.replace(/\r\n/g, '\n')
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        dispatch(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf('\n\n')
      }
    },
    end() {
      if (buffer.trim()) dispatch(buffer)
      buffer = ''
    },
  }
}

/**
 * Consumes a Gemini `streamGenerateContent?alt=sse` body. Each SSE `data:` line
 * is a GenerateContentResponse chunk shaped like
 * `{ candidates: [{ content: { parts: [{ text: "..." }] } }] }`; failures arrive as
 * `{ error: { code, message, status } }`.
 */
async function consumeStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
  onChunk: (text: string) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const state: { error: AppError | null; received: boolean } = { error: null, received: false }

  const parser = createSSEParser(({ data }) => {
    if (data === '[DONE]') return
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      return
    }
    if (!isRecord(payload)) return

    if (isRecord(payload.error)) {
      const apiError = payload.error
      const status = typeof apiError.status === 'string' ? apiError.status : undefined
      const message = typeof apiError.message === 'string' ? apiError.message : undefined
      state.error =
        mapGoogleStatus(status, message) ??
        new AppError('server', 'The AI provider returned an error while streaming.', message)
      return
    }

    if (Array.isArray(payload.candidates)) {
      for (const candidate of payload.candidates) {
        if (!isRecord(candidate)) continue
        const content = candidate.content
        if (!isRecord(content) || !Array.isArray(content.parts)) continue
        for (const part of content.parts) {
          // Skip thinking summaries; only visible answer text is shown.
          if (isRecord(part) && part.thought !== true && typeof part.text === 'string' && part.text) {
            state.received = true
            onChunk(part.text)
          }
        }
      }
    }
  })

  try {
    while (true) {
      throwIfAborted(signal)
      const { done, value } = await reader.read()
      if (done) break
      if (value) parser.feed(decoder.decode(value, { stream: true }))
      if (state.error) throw state.error
    }

    parser.feed(decoder.decode())
    parser.end()
    throwIfAborted(signal)
    if (state.error) throw state.error
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // the stream may already be closed
    }
  }

  if (!state.received) {
    throw new AppError('empty-response', 'The model returned an empty response.')
  }
}

/* ------------------------------------------------------------------ */
/* AI Provider: Google Gemini                                          */
/* ------------------------------------------------------------------ */

/** Streams a completion through the Google Gemini API. */
export const geminiProvider: LLMProvider = {
  id: 'gemini',
  label: 'Google Gemini',

  async streamCompletion({
    system,
    messages,
    model,
    apiKey,
    signal,
    maxTokens = DEFAULT_MAX_TOKENS,
    temperature = 0.2,
    onChunk,
  }: StreamCompletionParams): Promise<void> {
    if (!apiKey.trim()) {
      throw new AppError('missing-key', 'No API key is configured.')
    }
    if (!model.trim()) {
      throw new AppError('bad-request', 'No model is configured.')
    }
    if (messages.length === 0) {
      throw new AppError('bad-request', 'There is no message to send.')
    }

    throwIfAborted(signal)

    // Map retired aliases (including ones this extension used before) to a
    // model that still exists on the user's key.
    const requested = model.trim()
    const geminiModel = LEGACY_MODEL_ALIASES.has(requested.toLowerCase())
      ? DEFAULT_MODEL
      : requested

    let response: Response
    try {
      // Streaming requires the :streamGenerateContent method with alt=sse;
      // the plain :generateContent method does not stream.
      const url = `${GEMINI_API_URL}/models/${encodeURIComponent(geminiModel)}:streamGenerateContent?alt=sse`

      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey.trim(),
        },
        body: JSON.stringify({
          ...(system.trim() ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: messages.map((message) => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: message.content }],
          })),
          generationConfig: {
            temperature,
            maxOutputTokens: maxTokens,
          },
        }),
        signal,
      })
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw abortError()
      throw new AppError(
        'network',
        'Could not reach the AI API.',
        error instanceof Error ? error.message : String(error),
      )
    }

    if (!response.ok) {
      const raw = await response.text()
      let apiDetail = raw.slice(0, 300)
      let errorStatus: string | undefined
      try {
        const parsed: unknown = JSON.parse(raw)
        if (isRecord(parsed) && isRecord(parsed.error)) {
          if (typeof parsed.error.message === 'string') apiDetail = parsed.error.message
          if (typeof parsed.error.status === 'string') errorStatus = parsed.error.status
        }
      } catch {
        // keep the raw body as the detail when it is not JSON
      }

      if (response.status === 401 || response.status === 403) {
        throw new AppError('invalid-key', 'The API key was rejected.', apiDetail)
      }
      if (response.status === 404) {
        throw new AppError(
          'model-not-found',
          'The requested model was not found.',
          apiDetail || `Model "${geminiModel}" is not available for this API key.`,
        )
      }
      if (response.status === 429) {
        throw new AppError('rate-limit', 'The API rate limit was reached.', apiDetail)
      }
      if (response.status >= 500) {
        throw new AppError('server', 'The AI provider had a server error.', apiDetail)
      }
      if (response.status === 400 && apiDetail && isApiKeyMessage(apiDetail)) {
        throw new AppError('invalid-key', 'The API key was rejected.', apiDetail)
      }

      const mapped = mapGoogleStatus(errorStatus, apiDetail)
      if (mapped) throw mapped

      throw new AppError('bad-request', 'The AI provider rejected the request.', apiDetail)
    }

    if (!response.body) {
      throw new AppError('server', 'The AI provider returned an empty stream.')
    }

    try {
      await consumeStream(response.body, signal, onChunk)
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw abortError()
      if (error instanceof AppError) throw error
      throw new AppError(
        'network',
        'The connection was interrupted while the model was responding.',
        error instanceof Error ? error.message : String(error),
      )
    }
  },
}

/** Map of available providers. */
const PROVIDERS: Record<string, LLMProvider> = {
  gemini: geminiProvider,
}

/** Get a provider by ID. */
export function getProvider(providerId = 'gemini'): LLMProvider {
  return PROVIDERS[providerId] ?? geminiProvider
}

/** Streams a completion through the requested provider. */
export async function streamCompletion(
  params: StreamCompletionParams,
  providerId = 'gemini',
): Promise<void> {
  await getProvider(providerId).streamCompletion(params)
}

/** Convenience wrapper that buffers a streamed completion. */
export async function complete(params: CompletionParams, providerId = 'gemini'): Promise<string> {
  let text = ''
  await streamCompletion(
    {
      ...params,
      onChunk: (chunk) => {
        text += chunk
      },
    },
    providerId,
  )
  return text
}
