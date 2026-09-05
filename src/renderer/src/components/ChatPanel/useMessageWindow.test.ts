import { describe, expect, it } from 'vitest'
import { computeWindowRange } from './useMessageWindow'

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
