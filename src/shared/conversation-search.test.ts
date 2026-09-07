import { describe, expect, it } from 'vitest'
import { findTextMatch, searchableMessageText, searchExcerpt } from './conversation-search'

describe('conversation full-text matching', () => {
  it('matches Chinese and case-insensitive English as literal text', () => {
    expect(findTextMatch('此前讨论过 TypeScript 与中文检索', 'typescript')).toEqual({ start: 6, end: 16 })
    expect(findTextMatch('a+b [draft]', '[draft]')).toEqual({ start: 4, end: 11 })
    expect(findTextMatch('anything', '.*')).toBeNull()
    expect(findTextMatch('anything', '   ')).toBeNull()
  })

  it('preserves original offsets after Unicode case-insensitive matching', () => {
    expect(findTextMatch('İ-prefix TEST', 'test')).toEqual({ start: 9, end: 13 })
  })

  it('returns an excerpt centered on a historical match, including tool results', () => {
    const text = 'a'.repeat(1000) + 'important' + 'b'.repeat(1000)
    expect(searchExcerpt(text, 'important')).toContain('important')
    expect(searchExcerpt(text, 'important').length).toBeLessThan(140)
    expect(searchableMessageText({ content: '', toolData: { displayName: '读取文件', summary: '会议纪要' } })).toContain('会议纪要')
  })
})
