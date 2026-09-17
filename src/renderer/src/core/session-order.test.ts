import { describe, expect, it } from 'vitest'
import type { ChatSessionSummary } from '../shared/types'
import { mergeSessionsInCurrentOrder } from './session-order'

function session(id: string, title: string, updatedAt: number): ChatSessionSummary {
  return { id, title, preview: title, messageCount: 1, characterId: 'chouyu', createdAt: 1, updatedAt }
}

describe('visible session order', () => {
  it('updates card data without adopting database recency sorting', () => {
    const previous = [session('a', 'A', 10), session('b', 'B', 9), session('c', 'C', 8)]
    const updated = [session('b', 'B updated', 20), session('a', 'A', 10), session('c', 'C', 8)]

    const result = mergeSessionsInCurrentOrder(previous, updated)

    expect(result.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(result[1].title).toBe('B updated')
  })

  it('removes deleted cards and prepends genuinely new cards', () => {
    const previous = [session('a', 'A', 10), session('b', 'B', 9)]
    const updated = [session('c', 'C', 12), session('b', 'B', 9)]

    expect(mergeSessionsInCurrentOrder(previous, updated).map((item) => item.id)).toEqual(['c', 'b'])
  })

  it('keeps existing cards stable through saves, creation and background replies', () => {
    const initial = [session('a', 'A', 30), session('b', 'B', 20), session('c', 'C', 10)]
    const saved = mergeSessionsInCurrentOrder(initial, [session('c', 'C', 40), initial[0], initial[1]])
    const created = mergeSessionsInCurrentOrder(saved, [session('d', 'D', 50), saved[2], saved[0], saved[1]])
    const replied = mergeSessionsInCurrentOrder(created, [session('b', 'B replied', 60), ...created.filter(item => item.id !== 'b')])

    expect(saved.map(item => item.id)).toEqual(['a', 'b', 'c'])
    expect(created.map(item => item.id)).toEqual(['d', 'a', 'b', 'c'])
    expect(replied.map(item => item.id)).toEqual(['d', 'a', 'b', 'c'])
    expect(replied[2].title).toBe('B replied')
  })
})
