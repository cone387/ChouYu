import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import MessageArea from './MessageArea'
import { avatarPresentation } from '../CharacterAvatar/CharacterAvatar'

// This rendering test exercises identity; browser measurement is covered separately.
vi.mock('./useChatScroll', () => ({ useChatScroll: () => ({ hasNewContent: false, scrollToLatest: () => {} }) }))
vi.mock('./useMessageWindow', () => ({ useMessageWindow: () => ({ start: 0, end: 0, startOffset: 0, endOffset: 0, measureRow: () => {} }) }))

describe('message sender identity', () => {
  const character = { id: 'mentor', name: '代码导师', avatar: '👨‍💻' }
  it('renders the selected contact for both history and the pending reply', () => {
    const history = renderToStaticMarkup(createElement(MessageArea, { character, isStreaming: false, messages: [{ id: 'reply', role: 'assistant', content: '你好', timestamp: 1 }] }))
    const pending = renderToStaticMarkup(createElement(MessageArea, { character, isStreaming: true, messages: [{ id: 'question', role: 'user', content: '你好', timestamp: 1 }] }))
    for (const markup of [history, pending]) {
      expect(markup).toContain(avatarPresentation(character).src)
      expect(markup).toContain('data-avatar-kind="image"')
      expect(markup).toContain('代码导师')
    }
  })
  it('uses edited avatar data on subsequent renders', () => {
    const updated = { ...character, avatar: '@zhou' }
    const markup = renderToStaticMarkup(createElement(MessageArea, { character: updated, isStreaming: true, messages: [] }))
    expect(markup).toContain(avatarPresentation(updated).src)
    expect(markup).not.toContain('👨‍💻')
  })
})
