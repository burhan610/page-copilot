import { Readability } from '@mozilla/readability'
import { cleanText, countWords } from '../lib/extract'
import type { ContentRequest, ContentResponse, PageContent } from '../types'

type ContentListener = Parameters<typeof chrome.runtime.onMessage.addListener>[0]

declare global {
  interface Window {
    __pageCopilotListener?: ContentListener
  }
}

function extractPage(): PageContent {
  const url = window.location.href
  const documentTitle = document.title || url
  const lang = document.documentElement.lang || navigator.language || 'unknown'

  let bodyText = ''
  try {
    bodyText = document.body?.innerText ?? ''
  } catch {
    bodyText = ''
  }

  let articleText = ''
  let articleTitle = ''
  try {
    // Readability mutates the document it parses, so give it a clone. The live
    // page is never touched.
    const clone = document.cloneNode(true) as Document
    const article = new Readability(clone, { charThreshold: 100 }).parse()
    if (article) {
      articleText = article.textContent ?? ''
      articleTitle = article.title ?? ''
    }
  } catch {
    articleText = ''
  }

  const cleanedArticle = cleanText(articleText)
  const cleanedBody = cleanText(bodyText)
  const useArticle = cleanedArticle.length >= 100 && cleanedArticle.length >= cleanedBody.length * 0.25
  const text = useArticle ? cleanedArticle : cleanedBody

  return {
    title: cleanText(articleTitle) || cleanText(documentTitle),
    url,
    text,
    wordCount: countWords(text),
    lang: cleanText(lang) || 'unknown',
    extraction: useArticle ? 'readability' : 'body',
  }
}

function getSelectionText(): string {
  try {
    return window.getSelection()?.toString().trim() ?? ''
  } catch {
    return ''
  }
}

function handleRequest(message: ContentRequest): ContentResponse {
  if (message.type === 'GET_PAGE_CONTENT') {
    return { type: 'PAGE_CONTENT', page: extractPage() }
  }
  return { type: 'SELECTION', text: getSelectionText() }
}

function init(): void {
  const listener: ContentListener = (message, _sender, sendResponse) => {
    const request = message as ContentRequest
    if (request?.type !== 'GET_PAGE_CONTENT' && request?.type !== 'GET_SELECTION') return false

    try {
      sendResponse(handleRequest(request))
    } catch (error) {
      sendResponse({
        type: 'CONTENT_ERROR',
        message: error instanceof Error ? error.message : 'Page Copilot could not read this page.',
      })
    }
    return false
  }

  // A listener from an earlier run of this script is stale in this extension
  // context, so replace it instead of stacking a second one.
  if (window.__pageCopilotListener) {
    try {
      chrome.runtime.onMessage.removeListener(window.__pageCopilotListener)
    } catch {
      /* The page kept the function after an extension reload: nothing to remove. */
    }
  }

  window.__pageCopilotListener = listener
  chrome.runtime.onMessage.addListener(listener)
}

// The manifest injects this script on every page load, and the service worker
// re-injects it when a tab predates the extension. Always attach: after an
// extension reload the page still holds the previous run's marker, whose
// listener belongs to a dead extension context and can no longer answer.
init()
