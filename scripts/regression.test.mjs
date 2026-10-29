import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nativeRequire = createRequire(import.meta.url)
const modules = new Map()

// Exercise the actual TypeScript modules using the project's existing compiler.
function load(relativePath) {
  const filename = resolve(root, relativePath)
  if (modules.has(filename)) return modules.get(filename).exports
  const module = { exports: {} }
  modules.set(filename, module)
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: filename,
  })
  const require = (id) => {
    if (!id.startsWith('.')) return nativeRequire(id)
    const path = resolve(dirname(filename), id)
    return load([`${path}.ts`, `${path}.tsx`, `${path}/index.ts`].find(existsSync))
  }
  vm.runInThisContext(`(function(require, module, exports) {\n${outputText}\n})`, {
    filename,
  })(require, module, module.exports)
  return module.exports
}

const llm = load('src/lib/llm.ts')
const storage = load('src/lib/storage.ts')
const { chunkText } = load('src/lib/extract.ts')

function mockFetch(t, implementation) {
  const previous = globalThis.fetch
  globalThis.fetch = implementation
  t.after(() => {
    globalThis.fetch = previous
  })
}

function streamResponse(text) {
  const bytes = new TextEncoder().encode(text)
  return new Response(
    new ReadableStream({
      start(controller) {
        // Each byte is a separate network chunk, including split UTF-8 and CRLF.
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
        controller.close()
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  )
}

for (const provider of [llm.openAiProvider, llm.groqProvider, llm.localProvider]) {
  test(`${provider.id}: send page instructions as a system message and decode streamed text`, async (t) => {
    mockFetch(t, async (_url, options) => {
      const body = JSON.parse(options.body)
      assert.deepEqual(body.messages, [
        { role: 'system', content: 'Use only the page. Reply in Urdu.' },
        { role: 'user', content: 'Summarize this page.' },
      ])
      for (const field of ['system', 'role', 'content']) assert.equal(field in body, false)
      if (provider.id !== 'local') {
        assert.equal(options.headers.Authorization, 'Bearer test-key')
      }
      return streamResponse(
        'data: {"choices":[{"delta":{"content":"سلام"}}]}\r\n\r\ndata: [DONE]\r\n\r\n',
      )
    })
    let result = ''
    await provider.streamCompletion({
      system: 'Use only the page. Reply in Urdu.',
      messages: [{ role: 'user', content: 'Summarize this page.' }],
      model: 'test-model',
      apiKey: ' test-key ',
      onChunk: (text) => {
        result += text
      },
    })
    assert.equal(result, 'سلام')
  })
}

test('Gemini: preserve system instructions and hide thought text', async (t) => {
  mockFetch(t, async (_url, options) => {
    const body = JSON.parse(options.body)
    assert.equal(options.headers['x-goog-api-key'], 'test-key')
    assert.equal(body.systemInstruction.parts[0].text, 'Page context')
    return streamResponse(
      'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"hidden"},{"text":"answer"}]}}]}\n\n',
    )
  })
  let result = ''
  await llm.geminiProvider.streamCompletion({
    system: 'Page context',
    messages: [{ role: 'user', content: 'Question' }],
    model: 'test-model',
    apiKey: 'test-key',
    onChunk: (text) => {
      result += text
    },
  })
  assert.equal(result, 'answer')
})

test('SSE: parse events at every possible network boundary', () => {
  for (const newline of ['\n', '\r\n', '\r']) {
    const input = `: keepalive${newline}event: answer${newline}data: first${newline}data: second${newline}${newline}data: third${newline}${newline}`
    for (let split = 0; split <= input.length; split += 1) {
      const events = []
      const parser = llm.createSSEParser((event) => events.push(event))
      parser.feed(input.slice(0, split))
      parser.feed(input.slice(split))
      parser.end()
      assert.deepEqual(events, [{ event: 'answer', data: 'first\nsecond' }, { data: 'third' }])
    }
  }
})

test('SSE: preserve final event without a blank terminator', () => {
  const events = []
  const parser = llm.createSSEParser((event) => events.push(event))
  parser.feed('data: final')
  parser.end()
  assert.deepEqual(events, [{ data: 'final' }])
})

test('provider: reject empty responses and surface authentication errors', async (t) => {
  mockFetch(t, async () => streamResponse('data: [DONE]\n\n'))
  const params = {
    system: '',
    messages: [{ role: 'user', content: 'Question' }],
    model: 'test-model',
    apiKey: 'test-key',
    onChunk() {},
  }
  await assert.rejects(llm.openAiProvider.streamCompletion(params), { code: 'empty-response' })
  globalThis.fetch = async () => new Response('{"error":{"message":"Rejected"}}', { status: 401 })
  await assert.rejects(llm.groqProvider.streamCompletion(params), { code: 'invalid-key' })
})

test('settings: explicit cloud mode takes precedence over the legacy local toggle', async (t) => {
  const previous = globalThis.chrome
  let settings = { useLocal: false, useOllama: true }
  globalThis.chrome = { storage: { sync: { get: async () => ({ settings }) } } }
  t.after(() => {
    globalThis.chrome = previous
  })
  assert.equal((await storage.getSettings()).useLocal, false)
  settings = { useOllama: true }
  assert.equal((await storage.getSettings()).useLocal, true)
})

test('chunking: overlap must not push a full paragraph beyond the size limit', () => {
  const first = 'alpha '.repeat(120).trim()
  const second = 'beta '.repeat(190).trim()
  const chunks = chunkText(`${first}\n\n${second}`, 1000, 200)
  assert.ok(chunks.every((chunk) => chunk.length <= 1000))
  assert.ok(chunks.join('\n').includes(second))
})

test('chunking: translation chunks keep every word without overlap', () => {
  const input = Array.from({ length: 1000 }, (_, i) => `word${i}`).join(' ')
  assert.equal(chunkText(input, 1000, 0).join(' '), input)
})

test('settings panel: show saved language and summary length controls', () => {
  const SettingsPanel = load('src/sidepanel/components/SettingsPanel.tsx').default
  const html = renderToStaticMarkup(
    createElement(SettingsPanel, {
      open: true,
      apiKey: '',
      onClose() {},
      async onSave() {},
      settings: {
        language: 'Urdu',
        summaryLength: 'detailed',
        useLocal: true,
        localModel: 'local',
      },
    }),
  )
  assert.match(html, /id="response-language"/)
  assert.match(html, /value="Urdu" selected=""/)
  assert.match(html, /id="summary-length"/)
  assert.match(html, /value="detailed" selected=""/)
})
