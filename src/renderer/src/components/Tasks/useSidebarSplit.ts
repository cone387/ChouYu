import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'

export const SIDEBAR_SPLIT_KEY = 'chouyu:task-sidebar-split:v1'
const MIN_RATIO = 0.2
const MAX_RATIO = 0.8

export function parseSidebarSplit(raw: string | null): number | null {
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 100 && value <= 4000 ? Math.round(value) : null
}

export default function useSidebarSplit(sidebarRef: RefObject<HTMLElement | null>) {
  const [height, setHeight] = useState<number | null>(() => {
    try { return parseSidebarSplit(localStorage.getItem(SIDEBAR_SPLIT_KEY)) } catch { return null }
  })
  const [storageError, setStorageError] = useState('')
  const dragging = useRef(false)
  useEffect(() => {
    try {
      if (height === null) localStorage.removeItem(SIDEBAR_SPLIT_KEY)
      else localStorage.setItem(SIDEBAR_SPLIT_KEY, String(height))
      setStorageError('')
    } catch { setStorageError('侧栏分割位置暂时无法保存，重启后可能恢复默认。') }
  }, [height])
  const applyPointer = (event: PointerEvent<HTMLElement>) => {
    const sidebar = sidebarRef.current
    if (!sidebar) return
    const rect = sidebar.getBoundingClientRect()
    setHeight(Math.round(Math.min(Math.max(event.clientY - rect.top, rect.height * MIN_RATIO), rect.height * MAX_RATIO)))
  }
  const dividerProps = {
    role: 'separator' as const, tabIndex: 0, 'aria-orientation': 'horizontal' as const,
    'aria-label': '拖动调整视图区高度；双击恢复自动',
    title: '拖动调整视图区高度；双击恢复自动',
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      dragging.current = true
      try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* 指针已失效 */ }
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => { if (dragging.current) applyPointer(event) },
    onPointerUp: (event: PointerEvent<HTMLElement>) => { dragging.current = false; try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* 已释放 */ } },
    onPointerCancel: (event: PointerEvent<HTMLElement>) => { dragging.current = false; try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* 已释放 */ } },
    onDoubleClick: () => setHeight(null),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        const sidebar = sidebarRef.current
        const current = height ?? (sidebar ? sidebar.getBoundingClientRect().height * 0.4 : 200)
        setHeight(Math.round(event.key === 'ArrowUp' ? current - 10 : current + 10))
      } else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); setHeight(null) }
    }
  }
  const reset = useCallback(() => setHeight(null), [])
  return { height, dividerProps, storageError, reset }
}
