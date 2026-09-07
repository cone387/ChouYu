import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, RefObject } from 'react'

const HEIGHT_KEY = 'composer-height'
const MIN_HEIGHT = 92

export function useComposerResize(textareaRef: RefObject<HTMLTextAreaElement>, value: string) {
  const [height, setHeight] = useState<number | null>(null)
  const [maximum, setMaximum] = useState(220)
  const [resizing, setResizing] = useState(false)
  const changed = useRef(false)
  const drag = useRef<{ y: number; height: number; current: number } | null>(null)
  const clamp = useCallback((next: number) => Math.max(MIN_HEIGHT, Math.min(maximum, next)), [maximum])

  useEffect(() => {
    let mounted = true
    void window.electronAPI.db.getState(HEIGHT_KEY).then((stored) => {
      const parsed = Number(stored)
      if (mounted && !changed.current && stored && Number.isFinite(parsed) && parsed >= MIN_HEIGHT) setHeight(parsed)
    }).catch(() => {})
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    const textarea = textareaRef.current
    const area = textarea?.closest('.input-area')
    const panel = textarea?.closest('.chat-panel-main')
    if (!textarea || !area || !panel) return
    const measure = () => {
      // Reserve the toolbar, attachments, other notices and some message history.
      const siblings = Array.from(panel.children).filter((el) => el !== area && !el.classList.contains('message-area'))
      const occupied = siblings.reduce((sum, el) => sum + el.getBoundingClientRect().height, 0)
      const overhead = area.getBoundingClientRect().height - textarea.getBoundingClientRect().height
      setMaximum(Math.max(MIN_HEIGHT, Math.floor(panel.clientHeight - occupied - overhead - 96)))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(panel)
    observer.observe(area)
    for (const child of panel.children) observer.observe(child)
    measure()
    return () => observer.disconnect()
  }, [textareaRef])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.maxHeight = `${maximum}px`
    textarea.style.height = 'auto'
    textarea.style.height = `${height === null ? clamp(Math.min(textarea.scrollHeight, 220)) : clamp(height)}px`
  }, [clamp, height, maximum, textareaRef, value])

  const save = (next: number | null) => {
    void window.electronAPI.db.setState(HEIGHT_KEY, next === null ? '' : String(next)).catch(() => {})
  }
  const reset = () => {
    changed.current = true
    setHeight(null)
    save(null)
  }
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    save(drag.current.current)
    drag.current = null
    setResizing(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return {
    className: `composer-resize-handle${resizing ? ' is-resizing' : ''}`,
    role: 'separator',
    tabIndex: 0,
    'aria-label': '调整输入框高度',
    'aria-orientation': 'horizontal' as const,
    'aria-valuemin': MIN_HEIGHT,
    'aria-valuemax': maximum,
    'aria-valuenow': Math.round(clamp(height ?? textareaRef.current?.getBoundingClientRect().height ?? MIN_HEIGHT)),
    title: '上下拖动调整输入框高度；双击恢复自动高度',
    onDoubleClick: reset,
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !textareaRef.current) return
      event.preventDefault()
      event.stopPropagation()
      changed.current = true
      const current = textareaRef.current.getBoundingClientRect().height
      drag.current = { y: event.clientY, height: current, current }
      setResizing(true)
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (!drag.current) return
      const next = clamp(drag.current.height + drag.current.y - event.clientY)
      drag.current.current = next
      setHeight(next)
    },
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter') { event.preventDefault(); reset(); return }
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      changed.current = true
      const current = textareaRef.current?.getBoundingClientRect().height ?? MIN_HEIGHT
      const next = clamp(event.key === 'Home' ? MIN_HEIGHT : event.key === 'End' ? maximum : current + (event.key === 'ArrowUp' ? 16 : -16))
      setHeight(next)
      save(next)
    }
  }
}
