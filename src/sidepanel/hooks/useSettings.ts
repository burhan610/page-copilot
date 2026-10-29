import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, type Settings } from '../../types'
import {
  getApiKey,
  getSettings,
  saveApiKey,
  saveSettings,
  subscribeSettings,
} from '../../lib/storage'

export interface SettingsController {
  settings: Settings
  apiKey: string
  hasApiKey: boolean
  /** A cloud key is set, or a local model is enabled: something can answer. */
  ready: boolean
  loading: boolean
  save: (apiKey: string, next?: Partial<Settings>) => Promise<void>
}

export function useSettings(): SettingsController {
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS })
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    void Promise.all([getSettings(), getApiKey()])
      .then(([storedSettings, storedKey]) => {
        if (!active) return
        setSettings(storedSettings)
        setApiKey(storedKey)
        setLoading(false)
      })
      .catch(() => {
        if (active) setLoading(false)
      })

    const unsubscribe = subscribeSettings((nextSettings, nextKey) => {
      if (!active) return
      setSettings(nextSettings)
      setApiKey(nextKey)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const save = useCallback(
    async (apiKey: string, next?: Partial<Settings>): Promise<void> => {
      const normalized: Settings = {
        language: next?.language ?? settings.language,
        summaryLength: next?.summaryLength ?? settings.summaryLength,
        useLocal: next?.useLocal ?? settings.useLocal,
        localModel: next?.localModel ?? settings.localModel,
      }

      await Promise.all([saveSettings(normalized), saveApiKey(apiKey)])
      setSettings(normalized)
      setApiKey(apiKey.trim())
    },
    [settings],
  )

  const hasApiKey = apiKey.trim().length > 0

  return {
    settings,
    apiKey,
    hasApiKey,
    ready: hasApiKey || settings.useLocal,
    loading,
    save,
  }
}
