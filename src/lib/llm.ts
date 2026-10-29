import { AppError, LLMProvider } from '../types'

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

/** Model names this extension used in earlier releases. Google retired them, so
 *  they are mapped to the current default instead of failing with 404. */
const LEGACY_MODEL_ALIASES = new Set(['gemini', 'gemini api', 'gemini-pro', 'gemini pro'])

/** Groq model aliases that map to the current default so saved settings keep working. */
const GROQ_MODEL_ALIASES = new Set(['groq api', 'groq'])

/** Google Gemini API base URL. */
export const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta'

/** Local llama.cpp server (llama-server), reached over loopback only. */
export const LOCAL_API_URL = 'http://127.0.0.1:8090'

/** Model used when the user enables a local model but has not picked one yet. */
export const DEFAULT_LOCAL_MODEL = 'qwen2.5-1.5b'

/** Default max output tokens for LLM calls. */
export const DEFAULT_MAX_TOKENS = 4096

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

/** Google returns 400 INVALID_ARGUMENT for a bad key, so match on the message too. */
function isApiKeyMessage(message: string): boolean {
  return (
    /api[_ ]key/i.test(message) && /(not valid|invalid|denied|rejected|missing)/i.test(message)
  )
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
      ? "gemini-2.5-flash" : requested

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

/* ------------------------------------------------------------------ */
/* AI Provider: Groq                                                   */
/* ------------------------------------------------------------------ */

/** Streams a completion through the Groq API. */
export const groqProvider: LLMProvider = {
  id: 'groq',
  label: 'Groq',

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

    // Normalize model name: alias mapping + Groq model IDs.
    let groqModel = model.trim()
    const normalized = groqModel.toLowerCase()
    if (GROQ_MODEL_ALIASES.has(normalized)) {
      groqModel = "llama-3.3-70b-versatile"
    }

    let response: Response
    try {
      // Groq Chat Completions API: POST https://api.groq.com/openai/v1/chat/completions
      const url = 'https://api.groq.com/openai/v1/chat/completions'

      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          messages: [
            ...(system.trim() ? [{ role: 'system', content: system }] : []),
            ...messages,
          ],
          model: groqModel,
          temperature,
          max_tokens: maxTokens,
          stream: true,
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
      let errorCode: string | undefined
      try {
        const parsed = parseGroqErrorResponse(raw)
        if (parsed.code) errorCode = parsed.code
        if (parsed.message) apiDetail = parsed.message
      } catch {
        // keep raw body as detail when it is not JSON
      }

      if (response.status === 401 || response.status === 403) {
        throw new AppError('invalid-key', 'The API key was rejected.', apiDetail)
      }
      if (response.status === 429) {
        throw new AppError('rate-limit', 'The API rate limit was reached.', apiDetail)
      }
      if (response.status >= 500) {
        throw new AppError('server', 'The AI provider had a server error.', apiDetail)
      }
      const mapped = mapGroqError(errorCode, apiDetail)
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

/* ------------------------------------------------------------------ */
/* AI Provider: OpenAI                                                 */
/* ------------------------------------------------------------------ */

/** Streams a completion through the OpenAI API. */
export const openAiProvider: LLMProvider = {
  id: 'openai',
  label: 'OpenAI',

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

    let response: Response
    try {
      // OpenAI Chat Completions API: POST https://api.openai.com/v1/chat/completions
      const url = 'https://api.openai.com/v1/chat/completions'

      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          messages: [
            ...(system.trim() ? [{ role: 'system', content: system }] : []),
            ...messages,
          ],
          model,
          temperature,
          max_tokens: maxTokens,
          stream: true,
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
      let errorCode: string | undefined
      try {
        const parsed = parseOpenAiErrorResponse(raw)
        if (parsed.code) errorCode = parsed.code
        if (parsed.message) apiDetail = parsed.message
      } catch {
        // keep raw body as detail when it is not JSON
      }

      if (response.status === 401 || response.status === 403) {
        throw new AppError('invalid-key', 'The API key was rejected.', apiDetail)
      }
      if (response.status === 429) {
        throw new AppError('rate-limit', 'The API rate limit was reached.', apiDetail)
      }
      if (response.status >= 500) {
        throw new AppError('server', 'The AI provider had a server error.', apiDetail)
      }
      const mapped = mapOpenAiError(errorCode, apiDetail)
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

/** Maps an OpenAI error code to our AppError. */
function mapOpenAiError(code: string | undefined, message: string | undefined): AppError | null {
  const detail = message
  switch (code) {
    case 'invalid_api_key':
      return new AppError('invalid-key', 'The API key was rejected.', detail)
    case 'rate_limit':
    case 'limited':
      return new AppError('rate-limit', 'The API rate limit was reached.', detail)
    case 'insufficient_quota':
      return new AppError('rate-limit', 'You have exceeded your quota.', detail)
    case 'invalid_model':
      return new AppError('model-not-found', 'The requested model was not found.', detail)
    case 'internal_error':
      return new AppError('server', 'The AI provider had a server error.', detail)
    case 'content_filter':
      return new AppError('server', 'The response was blocked by content filters.', detail)
    default:
      return null
  }
}

/** Extracts the error code and message from an OpenAI API error response. */
function parseOpenAiErrorResponse(raw: string): { code?: string; message?: string } {
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const err = parsed.error
    if (!err || typeof err !== 'object') return {}
    return {
      code: typeof err.code === 'string' ? err.code : undefined,
      message: typeof err.message === 'string' ? err.message : undefined,
    }
  } catch {
    return {}
  }
}

/* ------------------------------------------------------------------ */
/* AI Provider: Local llama.cpp (no API key)                           */
/* ------------------------------------------------------------------ */

/** Streams a completion through a locally running llama.cpp server. */
export const localProvider: LLMProvider = {
  id: 'local',
  label: 'Local model (llama.cpp)',

  async streamCompletion({
    system,
    messages,
    model,
    signal,
    maxTokens = DEFAULT_MAX_TOKENS,
    temperature = 0.2,
    onChunk,
  }: StreamCompletionParams): Promise<void> {
    if (!model.trim()) {
      throw new AppError('bad-request', 'No local model is configured.')
    }
    if (messages.length === 0) {
      throw new AppError('bad-request', 'There is no message to send.')
    }

    throwIfAborted(signal)

    // OpenAI-compatible chat completions, streamed as server-sent events.
    const body = JSON.stringify({
      model: model.trim(),
      messages: [
        ...(system.trim() ? [{ role: 'system', content: system }] : []),
        ...messages.map((message) => ({
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: message.content,
        })),
      ],
      stream: true,
      temperature,
      max_tokens: maxTokens,
    })

    let response: Response
    try {
      response = await fetch(`${LOCAL_API_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal,
      })
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw abortError()
      throw new AppError(
        'network',
        'Could not reach the local model server.',
        'Start llama-server with your model, then try again. If Chrome asks for local network access, allow it.',
      )
    }

    if (!response.ok) {
      const raw = await response.text()
      const apiDetail = raw.slice(0, 300)

      if (response.status === 404) {
        throw new AppError(
          'model-not-found',
          'That model is not loaded by the local server.',
          apiDetail || `Serve it with: llama-server -m <model.gguf> --port 8090`,
        )
      }
      if (response.status === 401 || response.status === 403) {
        throw new AppError(
          'invalid-key',
          'The local model server refused this request.',
          apiDetail || 'llama-server was started with an API key this extension does not send.',
        )
      }
      if (response.status >= 500) {
        throw new AppError('server', 'The local model server had an error.', apiDetail)
      }
      throw new AppError('bad-request', 'The local model server rejected the request.', apiDetail)
    }

    if (!response.body) {
      throw new AppError('server', 'The local model server returned an empty stream.')
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

/** Lists the models the local llama.cpp server can serve. */
export async function listLocalModels(): Promise<string[]> {
  try {
    const response = await fetch(`${LOCAL_API_URL}/v1/models`, {
      method: 'GET',
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) return []
    const parsed: unknown = await response.json()
    if (!isRecord(parsed)) return []
    const data = Array.isArray(parsed.data) ? parsed.data : []
    return data
      .map((entry) => (isRecord(entry) && typeof entry.id === 'string' ? entry.id : undefined))
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
  } catch {
    return []
  }
}

/** Whether the wanted model is one the local server serves. */
export function isLocalModelInstalled(wanted: string, models: string[]): boolean {
  const target = wanted.trim().toLowerCase()
  if (!target) return true
  if (models.some((model) => model.trim().toLowerCase() === target)) return true
  // llama-server ignores the requested model name and serves whatever it was
  // started with, so a stale name still works against a single-model server.
  return models.length === 1
}

/** Map of available providers. */
const PROVIDERS: Record<string, LLMProvider> = {
  gemini: geminiProvider,
  groq: groqProvider,
  openai: openAiProvider,
  local: localProvider,
}

/** Get a provider by ID. */
export function getProvider(providerId = 'gemini'): LLMProvider {
  return PROVIDERS[providerId] ?? geminiProvider
}

/** Auto-detect provider from the API key prefix. */
export function getProviderIdFromKey(apiKey: string): string {
  const lower = apiKey.trim().toLowerCase()
  if (lower.startsWith('sk-')) return 'openai'
  if (lower.startsWith('gsk_')) return 'groq'
  if (lower.startsWith('aiza') || lower.startsWith('aq')) return 'gemini'
  return 'openai'
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

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

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
  let previousEndedWithCR = false

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
      if (!chunk) return
      // A CRLF pair can span network chunks; normalize it as one line ending.
      if (previousEndedWithCR && chunk.startsWith('\n')) chunk = chunk.slice(1)
      previousEndedWithCR = chunk.endsWith('\r')
      buffer += chunk.replace(/\r\n?/g, '\n')
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

/** Consumes a Gemini `streamGenerateContent?alt=sse` body. Each SSE `data:` line
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
    // OpenAI-compatible servers (llama.cpp, Groq, OpenAI) stream deltas.
    if (Array.isArray(payload.choices)) {
      for (const choice of payload.choices) {
        if (!isRecord(choice)) continue
        const delta = choice.delta
        if (isRecord(delta) && typeof delta.content === 'string' && delta.content) {
          state.received = true
          onChunk(delta.content)
        }
        const message = choice.message
        if (isRecord(message) && typeof message.content === 'string' && message.content) {
          state.received = true
          onChunk(message.content)
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
      // noop
    }
  }

  if (!state.received) {
    throw new AppError('empty-response', 'The model returned an empty response.')
  }
}

/** Maps a Groq error code to our AppError. */
function mapGroqError(code: string | undefined, message: string | undefined): AppError | null {
  const detail = message
  switch (code) {
    case 'invalid_authentication':
    case 'invalid_key':
      return new AppError('invalid-key', 'The API key was rejected.', detail)
    case 'rate_limit':
      return new AppError('rate-limit', 'The API rate limit was reached.', detail)
    case 'insufficient_quota':
    case 'resource_exhausted':
      return new AppError('rate-limit', 'You have exceeded your quota.', detail)
    case 'internal_server_error':
    case 'service_unavailable':
      return new AppError('server', 'The AI provider had a server error.', detail)
    case 'bad_request':
    case 'invalid_model':
      return new AppError('bad-request', 'The requested model is not available or invalid.', detail)
    default:
      return null
  }
}

/** Extracts the error code and message from a Groq API error response. */
function parseGroqErrorResponse(raw: string): { code?: string; message?: string } {
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const err = parsed.error
    if (!err || typeof err !== 'object') return {}
    return {
      code: typeof err.code === 'string' ? err.code : undefined,
      message: typeof err.message === 'string' ? err.message : undefined,
    }
  } catch {
    return {}
  }
}
