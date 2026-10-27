import { useEffect, useState } from 'react'
import { isRestrictedUrl } from '../../lib/extract'
import type { RestrictedPage } from '../../types'

export interface ActiveTabState {
  tab: chrome.tabs.Tab | null
  restricted: RestrictedPage | null
  loading: boolean
}

async function queryActiveTab(windowId: number | null): Promise<chrome.tabs.Tab | null> {
  const query: chrome.tabs.QueryInfo =
    windowId === null ? { active: true, lastFocusedWindow: true } : { active: true, windowId }
  const tabs = await chrome.tabs.query(query)
  return tabs[0] ?? null
}

export function useActiveTab(): ActiveTabState {
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    let windowId: number | null = null

    const apply = (next: chrome.tabs.Tab | null): void => {
      if (cancelled) return
      setTab(next)
      setLoading(false)
    }

    const load = async (): Promise<void> => {
      try {
        if (windowId === null) {
          try {
            const currentWindow = await chrome.windows.getCurrent()
            windowId = currentWindow.id ?? null
          } catch {
            windowId = null
          }
        }
        apply(await queryActiveTab(windowId))
      } catch {
        apply(null)
      }
    }

    void load()

    const onActivated = (info: chrome.tabs.TabActiveInfo): void => {
      if (windowId !== null && info.windowId !== windowId) return
      void chrome.tabs
        .get(info.tabId)
        .then(apply)
        .catch(() => void load())
    }

    const onUpdated = (
      _tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      updatedTab: chrome.tabs.Tab,
    ): void => {
      if (windowId !== null && updatedTab.windowId !== windowId) return
      if (!updatedTab.active) return
      if (
        changeInfo.url === undefined &&
        changeInfo.title === undefined &&
        changeInfo.favIconUrl === undefined
      ) {
        return
      }
      apply(updatedTab)
    }

    const onRemoved = (): void => {
      void load()
    }

    const onFocusChanged = (focusedWindowId: number): void => {
      if (focusedWindowId === chrome.windows.WINDOW_ID_NONE) return
      if (windowId !== null && focusedWindowId !== windowId) return
      void load()
    }

    chrome.tabs.onActivated.addListener(onActivated)
    chrome.tabs.onUpdated.addListener(onUpdated)
    chrome.tabs.onRemoved.addListener(onRemoved)
    chrome.windows.onFocusChanged.addListener(onFocusChanged)

    return () => {
      cancelled = true
      chrome.tabs.onActivated.removeListener(onActivated)
      chrome.tabs.onUpdated.removeListener(onUpdated)
      chrome.tabs.onRemoved.removeListener(onRemoved)
      chrome.windows.onFocusChanged.removeListener(onFocusChanged)
    }
  }, [])

  return { tab, restricted: isRestrictedUrl(tab?.url), loading }
}
