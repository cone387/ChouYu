import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { highlightCode } from '../../core/highlight'

const workspaceSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ChatPanel/useSessionWorkspace.ts'), 'utf8')
const inputSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ChatPanel/InputArea.tsx'), 'utf8')
const panelSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ChatPanel/ChatPanel.tsx'), 'utf8')

describe('syntax highlighting', () => {
  it('highlights known languages into hljs markup', () => {
    const html = highlightCode('const x = 1', 'typescript')
    expect(html).toContain('hljs-')
    expect(html).toContain('const')
  })

  it('resolves common language aliases', () => {
    expect(highlightCode('print(1)', 'py')).toContain('hljs-')
    expect(highlightCode('echo hi', 'sh')).toContain('hljs-')
    expect(highlightCode('<div></div>', 'html')).toContain('hljs-')
  })

  it('returns null for unknown or empty languages so plain rendering takes over', () => {
    expect(highlightCode('hello', 'not-a-language')).toBeNull()
    expect(highlightCode('hello', '')).toBeNull()
    expect(highlightCode('hello', '  ')).toBeNull()
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
