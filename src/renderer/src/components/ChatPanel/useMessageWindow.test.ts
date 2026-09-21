import { describe, expect, it } from 'vitest'
import { computeWindowRange, messageIndexAt, messageOffsets } from './useMessageWindow'

describe('measured message geometry', () => {
  it('updates only the measured row instead of rescaling the whole history', () => {
    const before = messageOffsets(200, new Map(), 12)
    const after = messageOffsets(200, new Map([[180, 300]]), 12)
    expect(after.slice(0, 181)).toEqual(before.slice(0, 181))
    expect(after[181] - before[181]).toBe(180)
    expect(after[200] - before[200]).toBe(180)
  })

  it('finds the visible row using mixed measured and estimated heights', () => {
    const offsets = messageOffsets(4, new Map([[0, 50], [1, 300], [3, 80]]), 12)
    expect(offsets).toEqual([0, 62, 374, 506, 598])
    expect(messageIndexAt(offsets, 61)).toBe(0)
    expect(messageIndexAt(offsets, 62)).toBe(1)
    expect(messageIndexAt(offsets, 373)).toBe(1)
    expect(messageIndexAt(offsets, 374)).toBe(2)
    expect(messageIndexAt(offsets, 10000)).toBe(3)
    expect(messageIndexAt([0], 0)).toBe(0)
  })
})

describe('computeWindowRange', () => {
  it('derives the visible range from scroll offset and row height', () => {
    expect(computeWindowRange(1000, 600, 120, 200)).toEqual({ start: 2, end: 19 })
  })

  it('clamps to the top when scrolled near the start', () => {
    const range = computeWindowRange(0, 600, 120, 200)
    expect(range.start).toBe(0)
    expect(range.end).toBeGreaterThan(0)
  })

  it('clamps start to the last row when the height estimate overshoots the list', () => {
    // Real heights far above the average make scrollTop/rowHeight exceed the
    // message count; the range must stay non-empty or the list blanks out.
    const range = computeWindowRange(50000, 600, 120, 50)
    expect(range.start).toBe(49)
    expect(range.end).toBe(50)
  })

  it('returns an empty range when there are no messages', () => {
    expect(computeWindowRange(0, 600, 120, 0)).toEqual({ start: 0, end: 0 })
  })
})
