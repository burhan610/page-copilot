import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_MODEL,
  DEFAULT_SETTINGS,
  type Settings,
  type SummaryLength,
} from '../../types'
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
  loading: boolean
  save: (settings: Settings, apiKey: string) => Promise<void>
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

  const save = useCallback(async (nextSettings: Settings, nextKey: string): Promise<void> => {
    const summaryLength: SummaryLength = nextSettings.summaryLength
    const normalized: Settings = {
      model: nextSettings.model.trim() || DEFAULT_MODEL,
      language: nextSettings.language.trim() || DEFAULT_SETTINGS.language,
      summaryLength,
    }

    await Promise.all([saveSettings(normalized), saveApiKey(nextKey)])
    setSettings(normalized)
    setApiKey(nextKey.trim())
  }, [])

  return {
    settings,
    apiKey,
    hasApiKey: apiKey.trim().length > 0,
    loading,
    save,
  }
}
