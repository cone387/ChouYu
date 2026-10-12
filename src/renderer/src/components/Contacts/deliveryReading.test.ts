import { describe, expect, it } from 'vitest'
import { deliveryText, textHash, type ReadingPosition } from '../../../../shared/contact-content'
import { anchorFromRenderedText, restoreReading, validPresentationEvent } from './deliveryReading'

describe('reading restoration', () => {
  const text = deliveryText('重复😀\n\n重复😀'), ref = { characterId: 'alice', topicId: 'task', version: 1, sectionId: 'a' }
  const position: ReadingPosition = { ref, scrollRatio: 0.8, updatedAt: 1, anchor: { start: 6, end: 10, quote: text.slice(6, 10), textHash: textHash(text) } }
  const section = { id: 'a', title: '正文', runId: 'r', body: '重复😀\n\n重复😀' }
  it('restores the exact second duplicate and UTF16 anchor', () => {
    expect(restoreReading(position, [section])).toEqual({ sectionId: 'a', anchor: position.anchor, changed: false })
  })
  it('maps rendered selection across Markdown block separators without choosing the first duplicate', () => {
    const canonical = '重复😀\n\n重复😀', rendered = '重复😀重复😀'
    expect(anchorFromRenderedText(canonical, rendered, 4, 8)).toEqual({ start: 6, end: 10, quote: '重复😀', textHash: textHash(canonical) })
    expect(() => anchorFromRenderedText(canonical, '另一份正文', 0, 2)).toThrow()
  })
  it('returns the same section start after a body edit and retains a removed section identity', () => {
    expect(restoreReading(position, [{ ...section, body: '修改后' }])).toEqual({ sectionId: 'a', changed: true })
    expect(restoreReading(position, [])).toEqual({ sectionId: 'a', changed: true })
  })
  it('rejects stale, foreign-frame, nonopaque-origin and forged custom-view events', () => {
    const source = {} as Window, data = { type: 'delivery-reading', ref, nonce: 'nonce', anchor: position.anchor, scrollRatio: 0.8 }
    const event = { source, origin: 'null', data } as unknown as MessageEvent
    expect(validPresentationEvent(event, source, ref, 'nonce', [section])).toBeTruthy()
    for (const change of [{ source: {} }, { origin: 'https://example.com' }, { data: { ...data, nonce: 'stale' } }, { data: { ...data, ref: { ...ref, version: 2 } } }, { data: { ...data, anchor: { ...position.anchor, quote: 'forged' } } }]) {
      expect(validPresentationEvent({ ...event, ...change } as MessageEvent, source, ref, 'nonce', [section])).toBeNull()
    }
  })
})
