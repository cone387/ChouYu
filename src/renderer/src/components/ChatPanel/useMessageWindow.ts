import { useEffect, useRef, useState } from 'react'

/**
 * Viewport windowing for the message list.
 *
 * Long sessions render every historical message on each update, which makes
 * streaming updates and scrolling visibly slower as a conversation grows.
 * This hook tracks which messages intersect the scroll viewport (plus a
 * buffer) and returns the index range that actually needs rendering; rows
 * outside the range are replaced by an estimated-height placeholder so the
 * scrollbar keeps its geometry.
 *
 * The estimate self-corrects: rendered rows report their measured height and
 * the average is used for out-of-window placeholders.
 */

/** Rows kept above/below the viewport before a message is unmounted. */
const OVERSCAN = 6
/** Assumed row height before any measurement exists. */
const INITIAL_ESTIMATED_ROW_HEIGHT = 120
/** Re-measure when the average drifts from the cached value by this ratio. */
const HEIGHT_DRIFT_RATIO = 0.15

export interface WindowRange {
  /** First index that must render (inclusive). */
  start: number
  /** Last index that must render (exclusive). */
  end: number
}

/**
 * Pure viewport math so the range rules are testable without a DOM.
 *
 * `start` is clamped to the last row: when real heights run far above the
 * estimated average (code-heavy sessions), scrollTop / rowHeight can exceed
 * the message count, and an unclamped start past `end` would render nothing.
 */
export function computeWindowRange(
  viewportTop: number,
  viewportHeight: number,
  averageRowHeight: number,
  count: number
): WindowRange {
  if (count <= 0) return { start: 0, end: 0 }
  const rowHeight = averageRowHeight > 0 ? averageRowHeight : INITIAL_ESTIMATED_ROW_HEIGHT
  const start = Math.min(
    Math.max(0, Math.floor(viewportTop / rowHeight) - OVERSCAN),
    count - 1
  )
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + OVERSCAN * 2
  const end = Math.min(count, start + visibleCount)
  return { start, end }
}

export interface MessageWindow {
  /** First index that must render (inclusive). */
  start: number
  /** Last index that must render (exclusive). */
  end: number
  /** Offset (from the top of the content box) where row `start` begins. */
  startOffset: number
  /** Estimated height of the rows below `end`, for placeholder rendering. */
  endOffset: number
  /** Current average row height, for placeholder rendering. */
  averageRowHeight: number
  /** Registers a rendered row's measured height. */
  measureRow: (index: number, height: number) => void
}

export function useMessageWindow(
  containerRef: React.RefObject<HTMLElement>,
  count: number,
  deps: unknown[] = []
): MessageWindow {
  const [range, setRange] = useState({ start: 0, end: Math.min(count, OVERSCAN * 2 + 1) })
  const [averageRowHeight, setAverageRowHeight] = useState(INITIAL_ESTIMATED_ROW_HEIGHT)
  const rowHeightsRef = useRef<Map<number, number>>(new Map())
  const totalMeasuredRef = useRef(0)

  // Reset the window and measurements whenever the message list identity
  // changes (session switch) but not when its length changes (streaming).
  useEffect(() => {
    rowHeightsRef.current.clear()
    totalMeasuredRef.current = 0
    setAverageRowHeight(INITIAL_ESTIMATED_ROW_HEIGHT)
    setRange({ start: 0, end: Math.min(count, OVERSCAN * 2 + 1) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const update = () => {
      const viewportTop = container.scrollTop
      const viewportHeight = container.clientHeight || container.getBoundingClientRect().height
      const { start: firstVisible, end: nextEnd } = computeWindowRange(
        viewportTop,
        viewportHeight,
        averageRowHeight,
        count
      )
      setRange((previous) =>
        previous.start === firstVisible && previous.end === nextEnd
          ? previous
          : { start: firstVisible, end: nextEnd }
      )
    }

    update()
    container.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(container)
    return () => {
      container.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [containerRef, count, averageRowHeight])

  const measureRow = (index: number, height: number) => {
    if (!Number.isFinite(height) || height <= 0) return
    const previous = rowHeightsRef.current.get(index)
    if (previous === height) return
    if (previous === undefined) totalMeasuredRef.current += 1
    rowHeightsRef.current.set(index, height)

    const measuredCount = totalMeasuredRef.current
    if (measuredCount < 4) return
    let sum = 0
    for (const value of rowHeightsRef.current.values()) sum += value
    const next = sum / measuredCount
    // Avoid feedback loops from tiny drifts: only accept meaningful changes.
    if (Math.abs(next - averageRowHeight) / averageRowHeight > HEIGHT_DRIFT_RATIO) {
      setAverageRowHeight(next)
    }
  }

  const startOffset = range.start * averageRowHeight
  const endOffset = Math.max(0, (count - range.end) * averageRowHeight)

  return { ...range, startOffset, endOffset, averageRowHeight, measureRow }
}
