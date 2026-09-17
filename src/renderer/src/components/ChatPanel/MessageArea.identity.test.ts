import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import MessageArea from './MessageArea'

// This rendering test exercises identity; browser measurement is covered separately.
vi.mock('./useChatScroll', () => ({ useChatScroll: () => ({ hasNewContent: false, scrollToLatest: () => {} }) }))
vi.mock('./useMessageWindow', () => ({ useMessageWindow: () => ({ start: 0, end: 0, startOffset: 0, endOffset: 0, measureRow: () => {} }) }))

describe('message sender identity', () => {
  const character = { id: 'mentor', name: '代码导师', avatar: '👨‍💻' }
  it('renders the selected contact for both history and the pending reply', () => {
    const history = renderToStaticMarkup(createElement(MessageArea, { character, isStreaming: false, messages: [{ id: 'reply', role: 'assistant', content: '你好', timestamp: 1 }] }))
    const pending = renderToStaticMarkup(createElement(MessageArea, { character, isStreaming: true, messages: [{ id: 'question', role: 'user', content: '你好', timestamp: 1 }] }))
    for (const markup of [history, pending]) {
      expect(markup).toContain('👨‍💻')
      expect(markup).not.toContain('data-avatar-kind="fish"')
      expect(markup).toContain('代码导师')
    }
  })
  it('uses edited avatar data on subsequent renders', () => {
    const markup = renderToStaticMarkup(createElement(MessageArea, { character: { ...character, avatar: '周' }, isStreaming: true, messages: [] }))
    expect(markup).toContain('>周</span>')
    expect(markup).not.toContain('👨‍💻')
  })
})
