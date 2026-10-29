import type { RestrictedPage } from '../types'

/** Pages over this length use the map-reduce path for page-wide actions. */
export const LONG_PAGE_THRESHOLD = 40_000
/** Approximate size of one map-reduce chunk. */
export const CHUNK_SIZE = 12_000
/** Characters of context carried into the next chunk for summaries. */
export const CHUNK_OVERLAP = 400

/**
 * Normalizes extracted text: unifies line endings, collapses runs of spaces,
 * trims lines and removes duplicate blank lines.
 */
export function cleanText(input: string): string {
  const normalized = input
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')

  const lines = normalized.split('\n').map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
  const output: string[] = []

  for (const line of lines) {
    if (line === '') {
      if (output.length > 0 && output[output.length - 1] !== '') output.push('')
    } else {
      output.push(line)
    }
  }

  while (output.length > 0 && output[output.length - 1] === '') output.pop()
  return output.join('\n').trim()
}

export function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

export function isLongPage(text: string, threshold = LONG_PAGE_THRESHOLD): boolean {
  return text.length > threshold
}

function splitLongBlock(block: string, maxChars: number, overlap: number): string[] {
  const pieces: string[] = []
  let rest = block
  let guard = 0

  while (rest.length > maxChars && guard < 10_000) {
    guard += 1

    let cut = rest.lastIndexOf('. ', maxChars)
    if (cut < maxChars * 0.5) cut = rest.lastIndexOf('\n', maxChars)
    if (cut < maxChars * 0.5) cut = rest.lastIndexOf(' ', maxChars)
    if (cut < Math.floor(maxChars * 0.5)) cut = maxChars
    else cut = Math.min(cut + 1, maxChars)

    const piece = rest.slice(0, cut).trim()
    if (piece) pieces.push(piece)

    const tailStart = Math.max(0, cut - overlap)
    const nextRest = rest.slice(tailStart).trimStart()
    if (nextRest.length >= rest.length) {
      rest = rest.slice(cut).trimStart()
    } else {
      rest = nextRest
    }
    if (!rest) break
  }

  if (rest.trim()) pieces.push(rest.trim())
  return pieces
}

/**
 * Splits text into chunks of about `maxChars` characters, preferring paragraph
 * boundaries and carrying a small overlap into the next chunk.
 */
export function chunkText(text: string, maxChars = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const cleaned = cleanText(text)
  if (!cleaned) return []

  const safeMax = Math.max(1_000, maxChars)
  const safeOverlap = Math.max(0, Math.min(overlap, Math.floor(safeMax / 4)))
  if (cleaned.length <= safeMax) return [cleaned]

  const blocks = cleaned.split(/\n{2,}/)
  const chunks: string[] = []
  let current = ''

  const push = (value: string) => {
    const trimmed = value.trim()
    if (trimmed) chunks.push(trimmed)
  }

  const overlapTail = (value: string): string => {
    if (safeOverlap === 0) return ''
    if (value.length <= safeOverlap) return value
    const tail = value.slice(-safeOverlap)
    const firstSpace = tail.search(/\s/)
    return firstSpace === -1 ? tail : tail.slice(firstSpace + 1).trimStart()
  }

  for (const block of blocks) {
    const trimmedBlock = block.trim()
    if (!trimmedBlock) continue

    if (trimmedBlock.length > safeMax) {
      push(current)
      current = ''
      for (const piece of splitLongBlock(trimmedBlock, safeMax, safeOverlap)) push(piece)
      continue
    }

    if (!current) {
      current = trimmedBlock
      continue
    }

    const candidate = `${current}\n\n${trimmedBlock}`
    if (candidate.length > safeMax) {
      push(current)
      const tail = overlapTail(current)
      current = tail && tail.length + 2 + trimmedBlock.length <= safeMax
        ? `${tail}\n\n${trimmedBlock}`
        : trimmedBlock
    } else {
      current = candidate
    }
  }

  push(current)
  return chunks
}

const STOPWORDS = new Set(
  'a an and are as at be been but by can could did do does for from had has have how i if in into is it its just like may might more most not of on or our out over said she should so some than that the their them then there these they this to was we were what when where which who why will with would you your'.split(
    ' ',
  ),
)

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []
}

/**
 * Picks the chunks most likely to answer a question on a long page, using a
 * simple term-frequency score. Keeps the first chunk for orientation.
 */
export function selectRelevantChunks(chunks: string[], query: string, maxChunks = 4): string[] {
  if (chunks.length === 0) return []
  if (chunks.length <= maxChunks) return [...chunks]

  const terms = [...new Set(tokenize(query).filter((term) => term.length > 2 && !STOPWORDS.has(term)))]
  const scored = chunks.map((chunk, index) => {
    const haystack = chunk.toLowerCase()
    let score = 0
    for (const term of terms) {
      let hits = 0
      let position = haystack.indexOf(term)
      while (position !== -1 && hits < 20) {
        hits += 1
        position = haystack.indexOf(term, position + term.length)
      }
      score += hits
    }
    return { index, chunk, score }
  })

  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  const chosen = scored.slice(0, Math.max(1, maxChunks))

  if (maxChunks > 1 && !chosen.some((item) => item.index === 0)) {
    chosen.pop()
    const first = scored.find((item) => item.index === 0)
    if (first) chosen.push(first)
  }

  chosen.sort((a, b) => a.index - b.index)
  return chosen.map((item) => item.chunk)
}

/** Returns a friendly explanation when Chrome will not let us read the page. */
export function isRestrictedUrl(url: string | undefined): RestrictedPage | null {
  if (!url) {
    return {
      reason: 'no-url',
      message: "This tab doesn't expose a readable address, so Page Copilot can't look at it.",
    }
  }

  if (/\.pdf(?:[?#]|$)/i.test(url)) {
    return {
      reason: 'pdf',
      message:
        "Page Copilot can't read PDFs yet — Chrome's PDF viewer doesn't share its text with extensions. Open a regular web page instead.",
    }
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return {
      reason: 'no-url',
      message: "This tab's address isn't readable, so Page Copilot can't look at it.",
    }
  }

  if (parsed.hostname === 'chromewebstore.google.com') {
    return {
      reason: 'webstore',
      message:
        'Chrome blocks extensions from reading the Chrome Web Store. Try Page Copilot on another page.',
    }
  }

  if (parsed.hostname === 'chrome.google.com' && parsed.pathname.startsWith('/webstore')) {
    return {
      reason: 'webstore',
      message:
        'Chrome blocks extensions from reading the Chrome Web Store. Try Page Copilot on another page.',
    }
  }

  const restrictedSchemes = [
    'chrome:',
    'chrome-untrusted:',
    'chrome-extension:',
    'edge:',
    'about:',
    'devtools:',
    'view-source:',
    'moz-extension:',
    'opera:',
  ]

  if (restrictedSchemes.includes(parsed.protocol)) {
    return {
      reason: 'browser',
      message:
        "Chrome doesn't let extensions read built-in pages like chrome://extensions. Open a normal website to use Page Copilot.",
    }
  }

  return null
}
