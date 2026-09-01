import { describe, expect, it } from 'vitest'
import type { ChatSessionSummary } from '../shared/types'
import { mergeSessionsInCurrentOrder } from './session-order'

function session(id: string, title: string, updatedAt: number): ChatSessionSummary {
  return { id, title, preview: title, messageCount: 1, createdAt: 1, updatedAt }
}

describe('visible session order', () => {
  it('updates card data without adopting database recency sorting', () => {
    const previous = [session('a', 'A', 10), session('b', 'B', 9), session('c', 'C', 8)]
    const updated = [session('b', 'B updated', 20), session('a', 'A', 10), session('c', 'C', 8)]

    const result = mergeSessionsInCurrentOrder(previous, updated)

    expect(result.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(result[1].title).toBe('B updated')
  })

  it('removes deleted cards and appends genuinely new cards', () => {
    const previous = [session('a', 'A', 10), session('b', 'B', 9)]
    const updated = [session('c', 'C', 12), session('b', 'B', 9)]

    expect(mergeSessionsInCurrentOrder(previous, updated).map((item) => item.id)).toEqual(['b', 'c'])
  })
})
