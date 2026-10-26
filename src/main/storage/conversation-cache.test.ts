import { expect, it, vi } from 'vitest'
import { ConversationCache } from './conversation-cache'
import type { ChatSession, Message } from '../../shared/conversations'
const meta = (id: string): Omit<ChatSession, 'messages'> => ({ id, title: id, characterId: 'a', createdAt: 1, updatedAt: 1 })
it('hydrates on demand, bounds clean entries and never evicts an unsaved replacement', () => {
  const read = vi.fn((id: string): Message[] => [{ id, role: 'user', content: id, timestamp: 1 }])
  const dirty = new Set<string>()
  const cache = new ConversationCache(read, id => dirty.has(id), id => dirty.add(id), 1, 1000)
  const a = cache.attach(meta('a')), b = cache.attach(meta('b')), c = cache.attach(meta('c'))
  expect(read).not.toHaveBeenCalled()
  expect(a.messages[0].content).toBe('a')
  a.messages = [{ id: 'new', role: 'user', content: 'unsaved', timestamp: 1 }]
  void b.messages; void c.messages
  expect(a.messages[0].content).toBe('unsaved')
  expect(read.mock.calls.filter(([id]) => id === 'a')).toHaveLength(1)
  dirty.clear(); cache.trim()
  expect(cache.size).toBe(1)
})
