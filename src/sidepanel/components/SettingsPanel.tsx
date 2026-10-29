import { useEffect, useRef, useState, type FormEvent } from 'react'
import { sendToBackground } from '../../lib/messaging'
import {
  LANGUAGE_OPTIONS,
  SUMMARY_LENGTH_OPTIONS,
  type ErrorInfo,
  type LocalModelsResult,
  type Settings,
  type TestKeyResult,
} from '../../types'
import ErrorBanner from './ErrorBanner'

export interface SettingsPanelProps {
  open: boolean
  apiKey: string
  settings: Settings
  onClose: () => void
  onSave: (apiKey: string, next?: Partial<Settings>) => Promise<void>
}

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'

export default function SettingsPanel({
  open,
  apiKey,
  settings,
  onClose,
  onSave,
}: SettingsPanelProps) {
  const [key, setKey] = useState(apiKey)
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success'>('idle')
  const [testError, setTestError] = useState<ErrorInfo | null>(null)
  const [useLocal, setUseLocal] = useState(settings.useLocal)
  const [localModel, setLocalModel] = useState(settings.localModel)
  const [language, setLanguage] = useState(settings.language)
  const [summaryLength, setSummaryLength] = useState(settings.summaryLength)
  const [installedModels, setInstalledModels] = useState<string[]>([])

  const apiKeyRef = useRef<HTMLInputElement>(null)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setKey(apiKey)
      setShowKey(false)
      setSaving(false)
      setSaveError(null)
      setTestStatus('idle')
      setTestError(null)
      setUseLocal(settings.useLocal)
      setLocalModel(settings.localModel)
      setLanguage(settings.language)
      setSummaryLength(settings.summaryLength)
    }
    wasOpenRef.current = open
  }, [open, apiKey, settings.useLocal, settings.localModel, settings.language, settings.summaryLength])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => apiKeyRef.current?.focus(), 40)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (!open || !useLocal) return
    let active = true
    void sendToBackground<LocalModelsResult>({ type: 'LIST_LOCAL_MODELS' })
      .then((result) => {
        if (!active) return
        setInstalledModels(result.models)
        // A saved model name can outlive the server that served it. If the field
        // still holds the untouched saved value and that model is gone, select
        // the one the server actually has so Save/Test cannot dead-end.
        const served = result.models
        setLocalModel((current) => {
          if (served.length === 0 || current !== settings.localModel) return current
          const known = served.some(
            (model) => model.trim().toLowerCase() === current.trim().toLowerCase(),
          )
          return known ? current : (served[0] ?? current)
        })
      })
      .catch(() => {
        if (active) setInstalledModels([])
      })
    return () => {
      active = false
    }
  }, [open, useLocal, settings.localModel])

  if (!open) return null

  const handleTest = async (): Promise<void> => {
    if (!useLocal && !key.trim()) {
      setTestStatus('idle')
      setTestError({ code: 'missing-key' as ErrorInfo['code'] })
      return
    }

    setTestStatus('testing')
    setTestError(null)

    try {
      const result = await sendToBackground<TestKeyResult>({
        type: 'TEST_KEY',
        apiKey: key.trim(),
        useLocal,
        localModel: localModel.trim(),
      })

      if (result.ok) {
        setTestStatus('success')
      } else {
        setTestStatus('idle')
        setTestError(result.error ?? { code: 'unknown' })
      }
    } catch (error) {
      setTestStatus('idle')
      setTestError({
        code: 'network' as ErrorInfo['code'],
        detail: error instanceof Error ? error.message : undefined,
      })
    }
  }

  const handleSave = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()

    setSaving(true)
    setSaveError(null)

    try {
      await onSave(key, { useLocal, localModel: localModel.trim(), language, summaryLength })
      onClose()
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'Could not save. Please try again.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl dark:bg-slate-950"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2
            id="settings-title"
            className="text-sm font-semibold text-slate-900 dark:text-slate-100"
          >
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              fill="currentColor"
              className="h-4 w-4"
            >
              <path d="M4.28 3.22a.75.75 0 0 0-1.06 1.06L6.94 8l-3.72 3.72a.75.75 0 1 0 1.06 1.06L8 9.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L9.06 8l3.72-3.72a.75.75 0 0 0-1.06-1.06L8 6.94 4.28 3.22Z" />
            </svg>
          </button>
        </header>

        <form onSubmit={(event) => void handleSave(event)} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 scrollbar-thin">
            <div>
              <label htmlFor="response-language" className="block text-xs font-medium text-slate-700 dark:text-slate-200">
                Response language
              </label>
              <select id="response-language" value={language} onChange={(event) => setLanguage(event.target.value)} className={`${inputClass} mt-1`}>
                {!LANGUAGE_OPTIONS.some((option) => option === language) && (
                  <option value={language}>{language}</option>
                )}
                {LANGUAGE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="summary-length" className="block text-xs font-medium text-slate-700 dark:text-slate-200">
                Summary length
              </label>
              <select id="summary-length" value={summaryLength} onChange={(event) => {
                const option = SUMMARY_LENGTH_OPTIONS.find((option) => option.value === event.target.value)
                if (option) setSummaryLength(option.value)
              }} className={`${inputClass} mt-1`}>
                {SUMMARY_LENGTH_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div>
              <span className="block text-xs font-medium text-slate-700 dark:text-slate-200">
                Where answers come from
              </span>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setUseLocal(false)}
                  aria-pressed={!useLocal}
                  className={`rounded-lg border px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                    useLocal
                      ? 'border-slate-300 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'
                      : 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-500 dark:bg-brand-950/50 dark:text-brand-300'
                  }`}
                >
                  Cloud API
                  <span className="mt-0.5 block text-[10px] font-normal opacity-80">
                    Gemini, Groq or OpenAI key
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setUseLocal(true)}
                  aria-pressed={useLocal}
                  className={`rounded-lg border px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                    useLocal
                      ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-500 dark:bg-brand-950/50 dark:text-brand-300'
                      : 'border-slate-300 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'
                  }`}
                >
                  Local model
                  <span className="mt-0.5 block text-[10px] font-normal opacity-80">
                    Free, runs on this PC
                  </span>
                </button>
              </div>
            </div>

            {useLocal && (
              <div>
                <label
                  htmlFor="local-model"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-200"
                >
                  Model
                </label>
                <input
                  id="local-model"
                  list="local-models"
                  value={localModel}
                  onChange={(event) => {
                    setLocalModel(event.target.value)
                    setTestStatus('idle')
                    setTestError(null)
                  }}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="qwen2.5-1.5b"
                  className={`${inputClass} mt-1 font-mono text-xs`}
                />
                <datalist id="local-models">
                  {installedModels.map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
                <p className="mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                  {installedModels.length > 0
                    ? `Installed: ${installedModels.join(', ')}`
                    : 'No model found. Start the local server, then reopen Settings to list models.'}
                </p>
                <div className="mt-2 rounded-lg bg-slate-50 p-2.5 text-[10px] leading-relaxed text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  <p className="font-semibold text-slate-600 dark:text-slate-300">Start the local server</p>
                  <code className="mt-1 block rounded bg-slate-200 px-1.5 py-1 text-[10px] font-mono dark:bg-slate-800">
                    llama-server -m Qwen2.5-1.5B-Instruct-Q4_K_M.gguf --port 8090
                  </code>
                  <p className="mt-1">Models live in the <code className="font-mono">llamacpp\models</code> folder.</p>
                </div>
              </div>
            )}

            {!useLocal && (
            <div>
              <label
                htmlFor="api-key"
                className="block text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                API key
              </label>
              <div className="relative mt-1">
                <input
                  ref={apiKeyRef}
                  id="api-key"
                  type={showKey ? 'text' : 'password'}
                  value={key}
                  onChange={(event) => {
                    setKey(event.target.value)
                    setTestStatus('idle')
                    setTestError(null)
                  }}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Your API key..."
                  aria-describedby="api-key-hint"
                  className={`${inputClass} pr-14 font-mono text-xs`}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((current) => !current)}
                  aria-label={showKey ? 'Hide API key' : 'Show API key'}
                  className="absolute inset-y-1 right-1 rounded-md px-2 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  {showKey ? 'Hide' : 'Show'}
                </button>
              </div>
              <p id="api-key-hint" className="mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                Stored only in this browser (chrome.storage.local) and never synced.
              </p>
            </div>
            )}

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleTest()}
                  disabled={
                    testStatus === 'testing' || (!useLocal && !key.trim())
                  }
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  {testStatus === 'testing' ? 'Testing…' : useLocal ? 'Test connection' : 'Test key'}
                </button>
                {testStatus === 'success' && (
                  <span
                    role="status"
                    className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      className="h-3 w-3"
                    >
                      <path d="M6.2 11.4 3 8.2l1.1-1.1 2.1 2.1 5.6-5.6L13 4.7l-6.8 6.7Z" />
                    </svg>
                    Connection works
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-[10px] leading-snug text-slate-500 dark:text-slate-400">
                Sends a tiny test message to check the key.
              </p>
              {testError && (
                <div className="mt-2">
                  <ErrorBanner error={testError} compact onDismiss={() => setTestError(null)} />
                </div>
              )}
            </div>

            <div className="rounded-lg bg-slate-50 p-2.5 text-[10px] leading-relaxed text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <p className="font-semibold text-slate-600 dark:text-slate-300">Auto-detection</p>
              <p className="mt-1">
                Pick the local model above for a key-free local model. For a cloud key, the provider is
                detected from the prefix ({' '}
                <code className="text-xs font-mono bg-slate-200 px-1 py-0.5 rounded dark:bg-slate-800">
                  sk-
                </code>
                {', '}
                <code className="text-xs font-mono bg-slate-200 px-1 py-0.5 rounded dark:bg-slate-800">
                  gsk_
                </code>
                {', '}
                <code className="text-xs font-mono bg-slate-200 px-1 py-0.5 rounded dark:bg-slate-800">
                  AQ
                </code>
                {', '}
                <code className="text-xs font-mono bg-slate-200 px-1 py-0.5 rounded dark:bg-slate-800">
                  AIza
                </code>
                {' '}. No configuration needed.
              </p>
            </div>

            <div className="rounded-lg bg-slate-50 p-2.5 text-[10px] leading-relaxed text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <p className="font-semibold text-slate-600 dark:text-slate-300">Privacy</p>
              <p className="mt-1">
                Page text, selections, and your questions are sent to the AI provider only when you
                run an action. There is no Page Copilot server. Your key stays in this browser and is
                never logged or synced.
              </p>
            </div>

            {saveError && (
              <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
                {saveError}
              </p>
            )}
          </div>

          <footer className="flex shrink-0 gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}
