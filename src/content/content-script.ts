import { Readability } from '@mozilla/readability'
import { cleanText, countWords } from '../lib/extract'
import type { ContentRequest, ContentResponse, PageContent } from '../types'

declare global {
  interface Window {
    __pageCopilotInjected?: boolean
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
  chrome.runtime.onMessage.addListener(
    (message: ContentRequest, _sender, sendResponse: (response: ContentResponse) => void) => {
      if (message?.type !== 'GET_PAGE_CONTENT' && message?.type !== 'GET_SELECTION') return false

      try {
        sendResponse(handleRequest(message))
      } catch (error) {
        sendResponse({
          type: 'CONTENT_ERROR',
          message: error instanceof Error ? error.message : 'Page Copilot could not read this page.',
        })
      }
      return false
    },
  )
}

// The manifest injects this script automatically. The service worker may also
// inject it into tabs that were already open when the extension was installed.
if (!window.__pageCopilotInjected) {
  window.__pageCopilotInjected = true
  init()
}
