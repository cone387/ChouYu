import { describe, expect, it } from 'vitest'
import { findVerticalOffset, stitchFrames, toRawFrame, type RawFrame } from './scroll-stitch'

const WIDTH = 64
const FRAME_HEIGHT = 200

/** Deterministic, row-unique pattern so vertical matching has a single answer. */
function pattern(row: number, col: number): number {
  return (row * 7919 + col * 104729) % 256
}

function makeFrame(startRow: number, options: { width?: number; height?: number; padding?: number; noise?: boolean } = {}): RawFrame {
  const width = options.width ?? WIDTH
  const height = options.height ?? FRAME_HEIGHT
  const padding = options.padding ?? 0
  const rowBytes = width * 4 + padding
  const buffer = Buffer.alloc(rowBytes * height)
  for (let r = 0; r < height; r += 1) {
    for (let c = 0; c < width; c += 1) {
      const p = r * rowBytes + c * 4
      const value = options.noise
        ? (r * 13 + c * 7 + startRow * 31) % 256
        : pattern(startRow + r, c)
      buffer[p] = 0
      buffer[p + 1] = value
      buffer[p + 2] = value
      buffer[p + 3] = 255
    }
  }
  return { buffer, width, height, rowBytes }
}

function readValue(frame: { buffer: Buffer; width: number; rowBytes: number }, row: number, col: number): number {
  return frame.buffer[row * frame.rowBytes + col * 4 + 1]
}

describe('toRawFrame', () => {
  it('derives the row stride from the payload size', () => {
    const buffer = Buffer.alloc(4 * 4 * 3)
    expect(toRawFrame(buffer, 4, 3)).toEqual({ buffer, width: 4, height: 3, rowBytes: 16 })
  })

  it('rejects payloads that cannot describe the dimensions', () => {
    const buffer = Buffer.alloc(10)
    expect(toRawFrame(buffer, 4, 3)).toBeNull()
    expect(toRawFrame(buffer, 0, 3)).toBeNull()
    expect(toRawFrame('nope' as unknown as Buffer, 4, 3)).toBeNull()
  })
})

describe('findVerticalOffset', () => {
  it('detects how far the next frame scrolled', () => {
    const prev = makeFrame(0)
    expect(findVerticalOffset(prev, makeFrame(60))).toBe(60)
    expect(findVerticalOffset(prev, makeFrame(1))).toBe(1)
    expect(findVerticalOffset(prev, makeFrame(120))).toBe(120)
  })

  it('reports zero for identical frames', () => {
    const prev = makeFrame(0)
    expect(findVerticalOffset(prev, makeFrame(0))).toBe(0)
  })

  it('reports failure when frames share no content', () => {
    const prev = makeFrame(0)
    expect(findVerticalOffset(prev, makeFrame(0, { noise: true }))).toBe(-1)
  })

  it('reports failure for mismatched dimensions', () => {
    const prev = makeFrame(0)
    expect(findVerticalOffset(prev, makeFrame(0, { height: 120 }))).toBe(-1)
  })
})

describe('stitchFrames', () => {
  it('appends only the rows revealed by each scroll', () => {
    const frames = [makeFrame(0), makeFrame(60), makeFrame(130)]
    const result = stitchFrames(frames)
    expect(result).not.toBeNull()
    expect(result!.offsets).toEqual([60, 70])
    expect(result!.segments).toBe(3)
    expect(result!.height).toBe(FRAME_HEIGHT + 60 + 70)
  })

  it('reproduces the underlying page content row by row', () => {
    const frames = [makeFrame(0), makeFrame(60), makeFrame(130)]
    const result = stitchFrames(frames)!
    const view = { buffer: result.buffer, width: result.width, rowBytes: result.width * 4 }
    for (const [row, col] of [[0, 0], [5, 31], [199, 63], [200, 10], [259, 3], [329, 63]]) {
      expect(readValue(view, row, col)).toBe(pattern(row, col))
    }
  })

  it('keeps padded source bitmaps aligned', () => {
    const frames = [makeFrame(0, { padding: 12 }), makeFrame(50, { padding: 12 })]
    const result = stitchFrames(frames)!
    expect(result.height).toBe(FRAME_HEIGHT + 50)
    const view = { buffer: result.buffer, width: result.width, rowBytes: result.width * 4 }
    expect(readValue(view, FRAME_HEIGHT, 0)).toBe(pattern(FRAME_HEIGHT, 0))
  })

  it('stops at the first unmatched frame', () => {
    const frames = [makeFrame(0), makeFrame(80), makeFrame(0, { noise: true })]
    const result = stitchFrames(frames)!
    expect(result.segments).toBe(2)
    expect(result.height).toBe(FRAME_HEIGHT + 80)
  })

  it('stops when the content stops moving', () => {
    const frames = [makeFrame(0), makeFrame(80), makeFrame(80)]
    const result = stitchFrames(frames)!
    expect(result.segments).toBe(2)
  })

  it('honours the output height cap', () => {
    const frames = [makeFrame(0)]
    for (let start = 150; start <= 900; start += 150) frames.push(makeFrame(start))
    const result = stitchFrames(frames, { maxHeight: 500 })!
    expect(result.height).toBeLessThanOrEqual(500 + 150)
  })

  it('returns a single frame untouched', () => {
    const result = stitchFrames([makeFrame(0)])!
    expect(result.height).toBe(FRAME_HEIGHT)
    expect(result.segments).toBe(1)
    expect(result.offsets).toEqual([])
  })

  it('returns null for an empty capture', () => {
    expect(stitchFrames([])).toBeNull()
  })
})
