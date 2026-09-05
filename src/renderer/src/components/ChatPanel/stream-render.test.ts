import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { highlightCode, isSupportedLanguage } from '../../core/highlight'

const workspaceSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ChatPanel/useSessionWorkspace.ts'), 'utf8')
const inputSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ChatPanel/InputArea.tsx'), 'utf8')
const panelSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ChatPanel/ChatPanel.tsx'), 'utf8')
const messageAreaSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ChatPanel/MessageArea.tsx'), 'utf8')
const chatPanelCssSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ChatPanel/ChatPanel.css'), 'utf8')

describe('syntax highlighting', () => {
  it('highlights known languages into hljs markup', async () => {
    const html = await highlightCode('const x = 1', 'typescript')
    expect(html).toContain('hljs-')
    expect(html).toContain('const')
  })

  it('resolves common language aliases', async () => {
    expect(await highlightCode('print(1)', 'py')).toContain('hljs-')
    expect(await highlightCode('echo hi', 'sh')).toContain('hljs-')
    expect(await highlightCode('<div></div>', 'html')).toContain('hljs-')
  })

  it('returns null for unknown or empty languages so plain rendering takes over', async () => {
    expect(await highlightCode('hello', 'not-a-language')).toBeNull()
    expect(await highlightCode('hello', '')).toBeNull()
    expect(await highlightCode('hello', '  ')).toBeNull()
  })

  it('reports language support synchronously without loading the highlighter', () => {
    expect(isSupportedLanguage('typescript')).toBe(true)
    expect(isSupportedLanguage('PY')).toBe(true)
    expect(isSupportedLanguage('not-a-language')).toBe(false)
    expect(isSupportedLanguage('')).toBe(false)
  })

  it('skips the async highlight round-trip for unsupported languages', () => {
    expect(messageAreaSource).toContain('isSupportedLanguage(lang)')
  })
})

describe('stream render throttling', () => {
  it('buffers chunks and flushes on a cadence instead of rendering per chunk', () => {
    expect(workspaceSource).toContain('STREAM_RENDER_INTERVAL_MS')
    expect(workspaceSource).toContain('scheduleRender()')
    expect(workspaceSource).toContain('renderAccumulated')
  })

  it('flushes buffered content before done, tool boundaries and manual stop', () => {
    expect(workspaceSource).toContain('generation.flushRender = renderAccumulated')
    expect(workspaceSource).toContain('generation.flushRender?.()')
    const doneIndex = workspaceSource.indexOf('if (done) {')
    expect(workspaceSource.indexOf('renderAccumulated()', doneIndex)).toBeLessThan(workspaceSource.indexOf('finishGeneration()', doneIndex))
  })
})

describe('message windowing', () => {
  it('only windows long sessions and keys the reset on the session, not the length', () => {
    expect(messageAreaSource).toContain('messages.length > 40')
    expect(messageAreaSource).toContain('messages[0].id')
    expect(messageAreaSource).toContain('useMessageWindow(scrollRef')
  })

  it('keeps scrollbar geometry with placeholders above and below the window', () => {
    expect(messageAreaSource).toContain('windowed.startOffset')
    expect(messageAreaSource).toContain('windowed.endOffset')
    expect(messageAreaSource).toContain('end < messages.length')
  })
})

describe('code block mac window styling', () => {
  it('renders decorative window dots in the code header', () => {
    expect(messageAreaSource).toContain('code-block-dots')
    expect(messageAreaSource).toContain('aria-hidden="true"')
  })

  it('unwraps the markdown pre so the card is not nested in a second pre', () => {
    expect(messageAreaSource).toContain('pre({ children })')
  })

  it('keeps legacy bubble pre/code rules from restyling the card', () => {
    expect(chatPanelCssSource).not.toContain('.message-assistant .message-bubble pre {')
    expect(chatPanelCssSource).not.toContain('.message-bubble pre,')
    expect(chatPanelCssSource).toContain('.message-assistant .message-bubble :not(pre) > code')
    expect(chatPanelCssSource).toContain('.message-bubble :not(pre) > code')
  })

  it('lets the card hug the code instead of stretching to the full bubble width', () => {
    const block = chatPanelCssSource.slice(
      chatPanelCssSource.indexOf('.code-block {'),
      chatPanelCssSource.indexOf('.code-block-header')
    )
    expect(block).toContain('width: fit-content')
    expect(block).toContain('max-width: 100%')
  })

  it('wraps code lines at spaces without breaking tokens mid-word', () => {
    const pre = chatPanelCssSource.slice(
      chatPanelCssSource.indexOf('.code-block pre {'),
      chatPanelCssSource.indexOf('.code-block .hljs-comment')
    )
    expect(pre).toContain('overflow-wrap: normal')
    expect(pre).toContain('word-break: normal')
    expect(pre).not.toContain('anywhere')
    expect(pre).not.toContain('break-word')
  })

  it('uses the card radius, 13px code font and accent copy button', () => {
    const block = chatPanelCssSource.slice(
      chatPanelCssSource.indexOf('.code-block {'),
      chatPanelCssSource.indexOf('.code-block-header')
    )
    expect(block).toContain('var(--radius-xl)')
    expect(block).toContain('box-shadow')

    const code = chatPanelCssSource.slice(
      chatPanelCssSource.indexOf('.code-block pre code'),
      chatPanelCssSource.indexOf('.code-block .hljs-comment')
    )
    expect(code).toContain('var(--font-md)')

    const copyStart = chatPanelCssSource.indexOf('.code-block-header .copy-btn')
    const hoverStart = chatPanelCssSource.indexOf('.code-block-header .copy-btn:hover', copyStart)
    const copyBtn = chatPanelCssSource.slice(copyStart, chatPanelCssSource.indexOf('}', hoverStart) + 1)
    expect(copyBtn).toContain('var(--accent)')
    expect(copyBtn).not.toContain('rgba(255, 255, 255')
  })
})

describe('composer history navigation', () => {
  it('exposes a history prop and browses it with arrow keys', () => {
    expect(inputSource).toContain('history?: string[]')
    expect(inputSource).toContain('historyIndex')
    expect(inputSource).toContain("e.key === 'ArrowUp' && history.length > 0")
    expect(inputSource).toContain("e.key === 'ArrowDown' && historyIndex !== null")
  })

  it('feeds session user messages into the composer history', () => {
    expect(panelSource).toContain('inputHistory')
    expect(panelSource).toContain("message.role === 'user' && !message.toolData")
    expect(panelSource).toContain('history={inputHistory}')
  })
})
