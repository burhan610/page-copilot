import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  DEFAULT_MODEL,
  LANGUAGE_OPTIONS,
  SUMMARY_LENGTH_OPTIONS,
  type ErrorInfo,
  type Settings,
  type TestKeyResult,
} from '../../types'
import { sendToBackground } from '../../lib/messaging'
import ErrorBanner from './ErrorBanner'

export interface SettingsPanelProps {
  open: boolean
  settings: Settings
  apiKey: string
  onClose: () => void
  onSave: (settings: Settings, apiKey: string) => Promise<void>
}

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'

export default function SettingsPanel({
  open,
  settings,
  apiKey,
  onClose,
  onSave,
}: SettingsPanelProps) {
  const [form, setForm] = useState<Settings>(settings)
  const [key, setKey] = useState(apiKey)
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success'>('idle')
  const [testError, setTestError] = useState<ErrorInfo | null>(null)

  const apiKeyRef = useRef<HTMLInputElement>(null)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setForm(settings)
      setKey(apiKey)
      setShowKey(false)
      setSaving(false)
      setSaveError(null)
      setTestStatus('idle')
      setTestError(null)
    }
    wasOpenRef.current = open
  }, [open, settings, apiKey])

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

  const languages = useMemo(() => {
    const list: string[] = [...LANGUAGE_OPTIONS]
    if (form.language && !list.includes(form.language)) list.unshift(form.language)
    return list
  }, [form.language])

  if (!open) return null

  const handleTest = async (): Promise<void> => {
    if (!key.trim()) {
      setTestStatus('idle')
      setTestError({ code: 'missing-key' })
      return
    }

    setTestStatus('testing')
    setTestError(null)

    try {
      const result = await sendToBackground<TestKeyResult>({
        type: 'TEST_KEY',
        apiKey: key.trim(),
        model: form.model.trim() || DEFAULT_MODEL,
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
        code: 'network',
        detail: error instanceof Error ? error.message : undefined,
      })
    }
  }

  const handleSave = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()

    if (!form.model.trim()) {
      setSaveError('Enter a model name, or use the default.')
      return
    }

    setSaving(true)
    setSaveError(null)

    try {
      await onSave({ ...form, model: form.model.trim() }, key)
      onClose()
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'Could not save settings. Please try again.',
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
          <h2 id="settings-title" className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
              <path d="M4.28 3.22a.75.75 0 0 0-1.06 1.06L6.94 8l-3.72 3.72a.75.75 0 1 0 1.06 1.06L8 9.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L9.06 8l3.72-3.72a.75.75 0 0 0-1.06-1.06L8 6.94 4.28 3.22Z" />
            </svg>
          </button>
        </header>

        <form onSubmit={(event) => void handleSave(event)} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 scrollbar-thin">
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
                  placeholder="sk-ant-…"
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
                Stored only in this browser (chrome.storage.local) and never synced.{' '}
                <a
                  href="https://console.ai-provider.com/keys"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-brand-600 underline underline-offset-2 hover:text-brand-700 dark:text-brand-300"
                >
                  Create a key
                </a>
              </p>
            </div>

            <div>
              <label
                htmlFor="model"
                className="block text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                Model
              </label>
              <input
                id="model"
                type="text"
                value={form.model}
                onChange={(event) => {
                  setForm((current) => ({ ...current, model: event.target.value }))
                  setTestStatus('idle')
                  setTestError(null)
                }}
                spellCheck={false}
                autoComplete="off"
                placeholder={DEFAULT_MODEL}
                aria-describedby="model-hint"
                className={`${inputClass} mt-1 font-mono text-xs`}
              />
              <p id="model-hint" className="mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                Default: {DEFAULT_MODEL}. Use the exact name of a model your key can access.
              </p>
            </div>

            <div>
              <label
                htmlFor="language"
                className="block text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                Response language
              </label>
              <select
                id="language"
                value={form.language}
                onChange={(event) =>
                  setForm((current) => ({ ...current, language: event.target.value }))
                }
                aria-describedby="language-hint"
                className={`${inputClass} mt-1`}
              >
                {languages.map((language) => (
                  <option key={language} value={language}>
                    {language}
                  </option>
                ))}
              </select>
              <p id="language-hint" className="mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                Answers and the Translate action both use this language.
              </p>
            </div>

            <div>
              <span
                id="summary-length-label"
                className="block text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                Summary length
              </span>
              <div
                role="radiogroup"
                aria-labelledby="summary-length-label"
                className="mt-1.5 grid grid-cols-3 gap-1.5"
              >
                {SUMMARY_LENGTH_OPTIONS.map((option) => {
                  const selected = form.summaryLength === option.value
                  return (
                    <label
                      key={option.value}
                      className={[
                        'cursor-pointer rounded-lg border px-2 py-1.5 text-center transition-colors focus-within:ring-2 focus-within:ring-brand-500 focus-within:ring-offset-2 dark:focus-within:ring-offset-slate-950',
                        selected
                          ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-500 dark:bg-brand-950/50 dark:text-brand-200'
                          : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800',
                      ].join(' ')}
                    >
                      <input
                        type="radio"
                        name="summary-length"
                        value={option.value}
                        checked={selected}
                        onChange={() =>
                          setForm((current) => ({ ...current, summaryLength: option.value }))
                        }
                        className="sr-only"
                      />
                      <span className="block text-xs font-medium">{option.label}</span>
                    </label>
                  )
                })}
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                {SUMMARY_LENGTH_OPTIONS.find((option) => option.value === form.summaryLength)?.hint}
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleTest()}
                  disabled={testStatus === 'testing' || !key.trim()}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  {testStatus === 'testing' ? 'Testing…' : 'Test key'}
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
                Sends a tiny test message to check the key and model.
              </p>
              {testError && (
                <div className="mt-2">
                  <ErrorBanner error={testError} compact onDismiss={() => setTestError(null)} />
                </div>
              )}
            </div>

            <div className="rounded-lg bg-slate-50 p-2.5 text-[10px] leading-relaxed text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <p className="font-semibold text-slate-600 dark:text-slate-300">Privacy</p>
              <p className="mt-1">
                Page text, selections, and your questions are sent to the AI provider only when you run an
                action. There is no Page Copilot server. Your key stays in this browser and is never
                logged or synced.
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
