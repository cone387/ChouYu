/**
 * Frame stitching primitives used by scrolling (long) screenshots.
 *
 * This module intentionally avoids importing `electron` so the matching and
 * stitching logic can be unit tested in plain Node.
 */

export interface RawFrame {
  /** Raw bitmap payload as returned by `nativeImage.toBitmap()`. */
  buffer: Buffer
  /** Frame width in pixels. */
  width: number
  /** Frame height in pixels. */
  height: number
  /** Bytes per row. Usually `width * 4`, but kept explicit so padded bitmaps stay correct. */
  rowBytes: number
}

export interface OffsetOptions {
  /** Upper bound for the comparison band height, in pixels. */
  bandHeight?: number
  /** Highest tolerated average per-channel difference for a match. */
  maxAverageDiff?: number
}

export interface StitchOptions extends OffsetOptions {
  /** Hard cap for the stitched output height, in pixels. */
  maxHeight?: number
}

export interface StitchResult {
  buffer: Buffer
  width: number
  height: number
  /** How many source frames ended up in the output. */
  segments: number
  /** Vertical offset detected for every appended frame. */
  offsets: number[]
}

/**
 * Wraps a raw bitmap in a {@link RawFrame}, deriving the row stride from the
 * payload size. Returns `null` when the buffer cannot possibly describe the
 * requested dimensions.
 */
export function toRawFrame(buffer: Buffer, width: number, height: number): RawFrame | null {
  if (!Buffer.isBuffer(buffer) || width <= 0 || height <= 0) return null
  const rowBytes = buffer.length / height
  if (!Number.isInteger(rowBytes) || rowBytes < width * 4) return null
  return { buffer, width, height, rowBytes }
}

function sampleColumns(width: number): number[] {
  const count = Math.min(32, Math.max(8, Math.floor(width / 8)))
  const step = width / count
  const columns: number[] = []
  for (let i = 0; i < count; i += 1) {
    columns.push(Math.max(0, Math.min(width - 1, Math.floor(i * step + step / 2))))
  }
  return columns
}

/**
 * Converts rows into greyscale samples for cheap comparison.
 *
 * Only bytes 1 and 2 of each pixel are averaged: for both BGRA and ARGB layouts
 * those hold the green/blue or red/green channels, so the average is identical
 * regardless of platform byte order.
 */
function greyscaleRows(frame: RawFrame, startRow: number, rows: number, columns: number[]): Uint8Array[] {
  const output = new Array<Uint8Array>(rows)
  for (let r = 0; r < rows; r += 1) {
    const rowStart = (startRow + r) * frame.rowBytes
    const row = new Uint8Array(columns.length)
    for (let c = 0; c < columns.length; c += 1) {
      const p = rowStart + columns[c] * 4
      row[c] = (frame.buffer[p + 1] + frame.buffer[p + 2]) >> 1
    }
    output[r] = row
  }
  return output
}

/**
 * Returns how many pixels `next` is scrolled down relative to `prev`.
 *
 * Returns `0` when the two frames are identical (the scroll reached its end)
 * and `-1` when no confident match was found.
 */
export function findVerticalOffset(prev: RawFrame, next: RawFrame, options: OffsetOptions = {}): number {
  if (prev.width !== next.width || prev.height !== next.height) return -1
  if (prev.rowBytes === next.rowBytes && prev.buffer.equals(next.buffer)) return 0

  const height = next.height
  const band = Math.max(4, Math.min(Math.floor(height * 0.3), options.bandHeight ?? 160, height - 1))
  const maxOffset = height - band
  if (maxOffset < 1) return -1

  const columns = sampleColumns(next.width)
  const needle = greyscaleRows(next, 0, band, columns)
  const haystack = greyscaleRows(prev, 0, height, columns)

  let bestOffset = 0
  let bestScore = Number.POSITIVE_INFINITY
  for (let offset = 1; offset <= maxOffset; offset += 1) {
    let diff = 0
    for (let r = 0; r < band; r += 1) {
      const a = needle[r]
      const b = haystack[offset + r]
      for (let c = 0; c < columns.length; c += 1) {
        diff += Math.abs(a[c] - b[c])
      }
    }
    const score = diff / (band * columns.length)
    if (score < bestScore) {
      bestScore = score
      bestOffset = offset
    }
  }

  return bestScore <= (options.maxAverageDiff ?? 12) ? bestOffset : -1
}

function copyRows(source: RawFrame, sourceRow: number, target: Buffer, targetRow: number, rows: number, width: number): void {
  const bytesPerRow = width * 4
  for (let r = 0; r < rows; r += 1) {
    const from = (sourceRow + r) * source.rowBytes
    const to = (targetRow + r) * bytesPerRow
    source.buffer.copy(target, to, from, from + bytesPerRow)
  }
}

/**
 * Stitches consecutive frames of a scrolling capture into a single bitmap.
 *
 * The first frame is copied in full; every following frame contributes only the
 * rows revealed by the scroll, as reported by {@link findVerticalOffset}.
 */
export function stitchFrames(frames: readonly RawFrame[], options: StitchOptions = {}): StitchResult | null {
  if (frames.length === 0) return null
  const first = frames[0]
  const width = first.width
  const frameHeight = first.height
  const maxHeight = options.maxHeight ?? 8000

  const offsets: number[] = []
  let totalHeight = frameHeight
  for (let i = 1; i < frames.length; i += 1) {
    const offset = findVerticalOffset(frames[i - 1], frames[i], options)
    if (offset <= 0) break
    if (totalHeight + offset > maxHeight) break
    offsets.push(offset)
    totalHeight += offset
  }

  const usedFrames = offsets.length + 1
  const buffer = Buffer.alloc(width * totalHeight * 4)
  copyRows(first, 0, buffer, 0, frameHeight, width)
  let writeRow = frameHeight
  for (let i = 1; i < usedFrames; i += 1) {
    const offset = offsets[i - 1]
    copyRows(frames[i], frameHeight - offset, buffer, writeRow, offset, width)
    writeRow += offset
  }

  return { buffer, width, height: writeRow, segments: usedFrames, offsets }
}
