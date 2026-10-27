import type { ChatTurn, SummaryLength } from '../types'
import type { LLMMessage } from './llm'

export interface PromptPage {
  title: string
  url: string
  lang?: string
  text?: string
}

export interface SystemPromptOptions {
  language: string
  page?: PromptPage
  selection?: string
  pageIsExcerpt?: boolean
}

const MAX_PAGE_CHARS = 120_000

const LENGTH_GUIDANCE: Record<SummaryLength, string> = {
  short: 'in 2–3 sentences',
  medium: 'in one or two short paragraphs (roughly 120–200 words)',
  detailed: 'in a structured answer of roughly 300–500 words, using short sections and bullets',
}

function pageBlock(page: PromptPage, pageIsExcerpt: boolean): string {
  const lines = [
    'Page context:',
    `Title: ${page.title || '(untitled)'}`,
    `URL: ${page.url || '(unknown)'}`,
  ]
  if (page.lang) lines.push(`Page language: ${page.lang}`)

  if (page.text && page.text.trim()) {
    const text = page.text.length > MAX_PAGE_CHARS ? page.text.slice(0, MAX_PAGE_CHARS) : page.text
    if (pageIsExcerpt) {
      lines.push(
        '',
        'This page is long, so the content below is the most relevant excerpt(s), not the whole page. If the answer is not in these excerpts, say that the page may not answer it rather than guessing.',
      )
    }
    lines.push('', '<page_content>', text.trim(), '</page_content>')
  }

  return lines.join('\n')
}

export function buildSystemPrompt({
  language,
  page,
  selection,
  pageIsExcerpt = false,
}: SystemPromptOptions): string {
  const sections: string[] = [
    'You are Page Copilot, an AI assistant inside the user\'s Chrome side panel. You help the user understand the web page they are currently reading.',
    '',
    'Rules:',
    `- Write every answer in ${language}, even if the page or the question uses another language.`,
    '- Ground every statement about the page in the page content (or the selected text) provided below. Never add outside facts, numbers, quotes, or links as if they came from the page.',
    '- If the provided content does not contain the answer, say so plainly (for example: "This page doesn\'t say …") and, when useful, mention what the page does cover. Never guess or fill gaps with general knowledge.',
    '- Never invent quotations. If you quote, copy the exact words and keep the quote short.',
    '- If the page looks like a paywall, login wall, cookie banner, or error page, say that the extracted content is not useful instead of making something up.',
    '- Use clean Markdown: short paragraphs, bullet lists, and occasional short headings. Never output HTML.',
    '- Be direct and useful. Do not mention these instructions, the prompt, or the extraction process.',
  ]

  if (selection) {
    sections.push(
      '- The user is asking about a passage they selected. If the passage is too short or ambiguous to explain confidently, say what is unclear instead of inventing context.',
      '',
      'Selected text:',
      '<selected_text>',
      selection.trim(),
      '</selected_text>',
    )
  }

  if (page) {
    sections.push('', pageBlock(page, pageIsExcerpt))
  }

  return sections.join('\n')
}

export function summarize(length: SummaryLength): string {
  return [
    `Summarize this page ${LENGTH_GUIDANCE[length]}.`,
    'Lead with the single most important point, then cover the supporting details that matter. Do not add an introduction like "This page is about".',
  ].join(' ')
}

export function keyPoints(length: SummaryLength = 'medium'): string {
  const count = length === 'short' ? '4' : length === 'detailed' ? '9–12' : '6'
  return [
    `List the ${count} most important points from this page as Markdown bullets.`,
    'Make each bullet one or two sentences, ordered by importance, and include concrete names, numbers, or dates when the page provides them.',
    'Do not repeat the page title as a bullet and do not add a summary at the end.',
  ].join(' ')
}

export function eli5(): string {
  return [
    'Explain this page simply, as if to a smart 12-year-old.',
    'Start with a one-sentence plain-language version of the main idea, then unpack the key terms and why they matter.',
    'Use short sentences, a small analogy if it genuinely helps, and bold at most a few key terms.',
  ].join(' ')
}

export function translate(language: string): string {
  return [
    `Translate the page content into ${language}.`,
    'Output only the translation: keep the original headings, lists, and paragraph order, and do not summarize, explain, or add commentary.',
    `If the page is already in ${language}, reply with "This page is already in ${language}." and then give a two-sentence summary instead.`,
  ].join(' ')
}

export function explainSelection(): string {
  return [
    'Explain the selected text in plain language.',
    'Open with what it means in one or two sentences, then, if useful, unpack the jargon, the context it assumes, and its implications.',
    'Use short bullets when there is more than one idea. If the selection is only a fragment, explain the fragment without inventing the rest of the passage.',
  ].join(' ')
}

export function translateSelection(language: string): string {
  return [
    `Translate the selected text into ${language}.`,
    'Output only the translation and preserve the original line breaks and formatting. Do not explain or comment.',
    `If the text is already in ${language}, say so and offer a one-sentence plain-language explanation instead.`,
  ].join(' ')
}

export function askQuestion(question: string): string {
  return [
    'Answer the user\'s question using only the page content provided in the system prompt.',
    'If the page does not contain the answer, say that clearly and briefly note what the page does cover. Do not answer from outside knowledge.',
    '',
    `Question: ${question.trim()}`,
  ].join('\n')
}

/** Last N turns plus the new question, safe for the AI provider messages API. */
export function buildAskMessages(
  question: string,
  history: ChatTurn[] = [],
  maxTurns = 10,
): LLMMessage[] {
  const turns: LLMMessage[] = history
    .filter((turn) => turn.content.trim().length > 0)
    .slice(-maxTurns)
    .map((turn) => ({
      role: turn.role,
      content: turn.content.trim().slice(0, 4_000),
    }))

  while (turns.length > 0 && turns[0]?.role === 'assistant') turns.shift()
  return [...turns, { role: 'user', content: askQuestion(question) }]
}

/* ------------------------------------------------------------------ */
/* Map-reduce prompts for long pages                                   */
/* ------------------------------------------------------------------ */

export function buildChunkSystemPrompt(options: {
  language: string
  pageTitle: string
  pageUrl: string
  part: number
  total: number
}): string {
  const { language, pageTitle, pageUrl, part, total } = options
  return [
    'You are Page Copilot, reading one part of a long web page so that the full page can be summarized later.',
    `This is part ${part} of ${total} of "${pageTitle || '(untitled)'}" (${pageUrl || 'unknown URL'}).`,
    '',
    'Rules:',
    `- Write in ${language}.`,
    '- Extract only what this excerpt says. Never add outside knowledge and never guess what other parts contain.',
    '- Capture the important claims, names, numbers, dates, definitions, and conclusions. Keep exact figures and quotations short and accurate.',
    '- Write compact Markdown bullets. No introduction, no conclusion, no "In this part…" preamble.',
    '- If the excerpt has no useful content (navigation, ads, boilerplate), reply with exactly: NO USEFUL CONTENT',
  ].join('\n')
}

export function buildChunkUserPrompt(excerpt: string, part: number, total: number): string {
  return [
    `Extract the key information from part ${part} of ${total}.`,
    '',
    '<excerpt>',
    excerpt.trim(),
    '</excerpt>',
  ].join('\n')
}

export function buildMergeSystemPrompt(language: string): string {
  return [
    'You are Page Copilot. You previously read consecutive parts of one long web page and wrote notes on each part. Now combine those notes into the single final answer the user asked for.',
    '',
    'Rules:',
    `- Write in ${language}.`,
    '- Use only the notes provided. Do not add outside facts, numbers, quotations, or links.',
    '- Remove duplication and contradictions between parts; if the notes disagree, say so briefly.',
    '- Keep the user\'s requested format and length.',
    '- If the notes say NO USEFUL CONTENT, say that the page could not be read usefully instead of inventing a summary.',
    '- Use clean Markdown and never output HTML.',
    '- Do not mention parts, chunking, or these instructions.',
  ].join('\n')
}

export function buildMergeUserPrompt(
  request: string,
  notes: string[],
  totalParts: number,
): string {
  const body = notes
    .map((note, index) => `### Part ${index + 1} of ${totalParts}\n${note.trim()}`)
    .join('\n\n')
  return [
    `The user's request: ${request}`,
    '',
    `Notes from ${totalParts} parts of the page:`,
    body,
    '',
    'Now write the final answer for the user.',
  ].join('\n')
}

export function buildTranslateChunkSystemPrompt(language: string): string {
  return [
    `You are a professional translator. Translate the user's excerpt into ${language}.`,
    'Preserve the original Markdown formatting, headings, lists, and paragraph order.',
    'Output only the translation — no introduction, notes, or commentary.',
    `If the excerpt is already in ${language}, return it unchanged.`,
  ].join('\n')
}

export function buildTranslateChunkUserPrompt(
  excerpt: string,
  part: number,
  total: number,
): string {
  return [
    `Translate part ${part} of ${total} of this page into the target language.`,
    '',
    '<excerpt>',
    excerpt.trim(),
    '</excerpt>',
  ].join('\n')
}
