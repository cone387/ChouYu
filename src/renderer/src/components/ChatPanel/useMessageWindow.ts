import { useLayoutEffect, useMemo, useRef, useState } from 'react'

/** Keep measured row heights across navigation; unmeasured rows use a stable estimate. */

/** Rows kept above/below the viewport before a message is unmounted. */
const OVERSCAN = 6
/** Assumed row height before any measurement exists. */
const INITIAL_ESTIMATED_ROW_HEIGHT = 120

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

export function messageOffsets(count: number, heights: ReadonlyMap<number, number>, gap: number): number[] {
  const offsets = [0]
  for (let index = 0; index < count; index++) {
    offsets.push(offsets[index] + (heights.get(index) ?? INITIAL_ESTIMATED_ROW_HEIGHT) + gap)
  }
  return offsets
}

export function messageIndexAt(offsets: readonly number[], top: number): number {
  let low = 0, high = Math.max(0, offsets.length - 2)
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (offsets[middle + 1] <= top) low = middle + 1
    else high = middle
  }
  return low
}

export function useMessageWindow(
  containerRef: React.RefObject<HTMLElement>,
  count: number,
  deps: unknown[] = [],
  active = true
): MessageWindow {
  const [range, setRange] = useState({ start: 0, end: Math.min(count, OVERSCAN * 2 + 1) })
  const [revision, setRevision] = useState(0)
  const [gap, setGap] = useState(12)
  const rowHeightsRef = useRef(new Map<number, number>())
  const anchor = useRef({ index: 0, bottom: true })
  const pendingAdjustment = useRef(0)
  const offsets = useMemo(() => messageOffsets(count, rowHeightsRef.current, gap), [count, gap, revision])

  useLayoutEffect(() => {
    rowHeightsRef.current.clear()
    pendingAdjustment.current = 0
    anchor.current = { index: 0, bottom: true }
    setRevision(value => value + 1)
    setRange({ start: 0, end: Math.min(count, OVERSCAN * 2 + 1) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!active || !container?.clientHeight) return
    if (pendingAdjustment.current) {
      container.scrollTop = anchor.current.bottom ? container.scrollHeight : container.scrollTop + pendingAdjustment.current
      pendingAdjustment.current = 0
    }
    const update = () => {
      if (!container.clientHeight) return
      const list = container.querySelector('.message-list')
      if (list) setGap(parseFloat(getComputedStyle(list).rowGap) || 0)
      const viewportTop = container.scrollTop
      const atBottom = container.scrollHeight - viewportTop - container.clientHeight <= 2
      const first = messageIndexAt(offsets, viewportTop)
      anchor.current = { index: first, bottom: atBottom }
      const start = atBottom ? Math.max(0, count - OVERSCAN * 2 - 1) : Math.max(0, first - OVERSCAN)
      const end = atBottom ? count : Math.min(count, messageIndexAt(offsets, viewportTop + container.clientHeight) + OVERSCAN + 1)
      setRange(previous => previous.start === start && previous.end === end ? previous : { start, end })
    }
    update()
    container.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(container)
    return () => { container.removeEventListener('scroll', update); observer.disconnect() }
  }, [active, containerRef, count, offsets])

  const measureRow = (index: number, height: number) => {
    if (!active || !containerRef.current?.clientHeight || !Number.isFinite(height) || height <= 0) return
    const previous = rowHeightsRef.current.get(index)
    if (previous === height) return
    rowHeightsRef.current.set(index, height)
    // Correct only rows above the reading anchor. Learning one row must never
    // resize every offscreen placeholder, which made long chats visibly jump.
    if (index < anchor.current.index) pendingAdjustment.current += height - (previous ?? INITIAL_ESTIMATED_ROW_HEIGHT)
    setRevision(value => value + 1)
  }

  const start = Math.min(range.start, count)
  const end = Math.min(range.end, count)
  const startOffset = start ? Math.max(0, offsets[start] - gap) : 0
  const endOffset = end < count ? Math.max(0, offsets[count] - offsets[end] - gap) : 0
  return { start, end, startOffset, endOffset, averageRowHeight: count ? offsets[count] / count - gap : INITIAL_ESTIMATED_ROW_HEIGHT, measureRow }
}
