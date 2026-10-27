import { PORT_NAME, type ContentRequest, type ContentResponse, type RuntimeMessage } from '../types'

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown error'
}

/** Sends a typed request to a tab's content script. */
export async function sendToTab(
  tabId: number,
  message: ContentRequest,
): Promise<ContentResponse> {
  try {
    return await chrome.tabs.sendMessage<ContentRequest, ContentResponse>(tabId, message)
  } catch (error) {
    throw new Error(`Could not reach the page: ${errorMessage(error)}`)
  }
}

/** Sends a typed one-off request to the service worker. */
export async function sendToBackground<T>(message: RuntimeMessage): Promise<T> {
  try {
    return await chrome.runtime.sendMessage<RuntimeMessage, T>(message)
  } catch (error) {
    throw new Error(errorMessage(error))
  }
}

/** Opens the long-lived port used for streamed answers. */
export function connectToBackground(): chrome.runtime.Port {
  return chrome.runtime.connect({ name: PORT_NAME })
}
