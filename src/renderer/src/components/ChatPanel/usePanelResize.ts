import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CHAT_CONTENT_MIN_WIDTH,
  PANEL_MIN_HEIGHT,
  SESSION_SIDEBAR_MAX_WIDTH,
  SESSION_SIDEBAR_MIN_WIDTH
} from '../../shared/constants'
import {
  CHAT_CONTENT_WIDTH_STATE_KEY,
  PANEL_HEIGHT_STATE_KEY,
  SESSION_SIDEBAR_WIDTH_STATE_KEY,
  getDefaultPanelHeight,
  normalizeChatContentWidth,
  normalizePanelHeight,
  normalizeSessionSidebarWidth
} from '../../core/panel-state'

export type PanelResizeEdge = 'top' | 'bottom'

interface UsePanelResizeOptions {
  position: { x: number; y: number }
  onPositionChange: (pos: { x: number; y: number }) => void
  /** True when the session sidebar is actually taking horizontal space. */
  sidebarOccupiesSpace: boolean
}

/**
 * Owns the three draggable panel dimensions (overall height, session sidebar
 * width, chat content width) plus their persistence and viewport clamping.
 *
 * Kept out of ChatPanel so that component can stay focused on conversation
 * state instead of pointer geometry bookkeeping.
 */
export function usePanelResize({ position, onPositionChange, sidebarOccupiesSpace }: UsePanelResizeOptions) {
  const [panelHeight, setPanelHeight] = useState(() => getDefaultPanelHeight(window.innerHeight))
  const [sessionSidebarWidth, setSessionSidebarWidth] = useState(() => normalizeSessionSidebarWidth(undefined))
  const [chatContentWidth, setChatContentWidth] = useState(() => normalizeChatContentWidth(undefined))
  const panelResizeRef = useRef({ resizing: false, edge: 'bottom' as PanelResizeEdge, startY: 0, startHeight: 0, startTop: 0, currentHeight: 0 })
  const sidebarResizeRef = useRef({ resizing: false, startX: 0, startWidth: 0, currentWidth: 0 })
  const contentResizeRef = useRef({ resizing: false, startX: 0, startWidth: 0, currentWidth: 0 })

  useEffect(() => {
    Promise.all([
      window.electronAPI.db.getState(PANEL_HEIGHT_STATE_KEY),
      window.electronAPI.db.getState(SESSION_SIDEBAR_WIDTH_STATE_KEY),
      window.electronAPI.db.getState(CHAT_CONTENT_WIDTH_STATE_KEY)
    ]).then(([storedHeight, storedSidebarWidth, storedContentWidth]) => {
      const sidebarWidth = normalizeSessionSidebarWidth(storedSidebarWidth)
      setPanelHeight(normalizePanelHeight(storedHeight, window.innerHeight))
      setSessionSidebarWidth(sidebarWidth)
      setChatContentWidth(normalizeChatContentWidth(storedContentWidth, window.innerWidth, sidebarWidth))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const clampToViewport = () => {
      setPanelHeight((current) => normalizePanelHeight(current, window.innerHeight))
      setChatContentWidth((current) => normalizeChatContentWidth(current, window.innerWidth, sessionSidebarWidth))
    }
    window.addEventListener('resize', clampToViewport)
    return () => window.removeEventListener('resize', clampToViewport)
  }, [sessionSidebarWidth])

  const handlePanelResizeStart = useCallback((edge: PanelResizeEdge, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    panelResizeRef.current = { resizing: true, edge, startY: event.screenY, startHeight: panelHeight, startTop: position.y, currentHeight: panelHeight }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [panelHeight, position.y])

  const handlePanelResizeMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!panelResizeRef.current.resizing) return
    const { edge, startY, startHeight, startTop } = panelResizeRef.current
    const delta = event.screenY - startY
    const maxHeight = edge === 'top'
      ? Math.max(PANEL_MIN_HEIGHT, startHeight + startTop - 4)
      : Math.max(PANEL_MIN_HEIGHT, window.innerHeight - startTop - 4)
    const requestedHeight = edge === 'top' ? startHeight - delta : startHeight + delta
    const nextHeight = Math.min(maxHeight, Math.max(PANEL_MIN_HEIGHT, requestedHeight))
    panelResizeRef.current.currentHeight = nextHeight
    setPanelHeight(nextHeight)
    if (edge === 'top') {
      const nextTop = startTop + startHeight - nextHeight
      onPositionChange({ x: position.x, y: nextTop })
    }
  }, [onPositionChange, position.x])

  const handlePanelResizeEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!panelResizeRef.current.resizing) return
    panelResizeRef.current.resizing = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    void window.electronAPI.db.setState(PANEL_HEIGHT_STATE_KEY, String(panelResizeRef.current.currentHeight))
  }, [])

  const handleSidebarResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    sidebarResizeRef.current = { resizing: true, startX: event.screenX, startWidth: sessionSidebarWidth, currentWidth: sessionSidebarWidth }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [sessionSidebarWidth])

  const handleSidebarResizeMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!sidebarResizeRef.current.resizing) return
    const requested = sidebarResizeRef.current.startWidth + event.screenX - sidebarResizeRef.current.startX
    const viewportMaximum = Math.max(SESSION_SIDEBAR_MIN_WIDTH, window.innerWidth - position.x - chatContentWidth - 16)
    const nextWidth = Math.min(SESSION_SIDEBAR_MAX_WIDTH, viewportMaximum, Math.max(SESSION_SIDEBAR_MIN_WIDTH, requested))
    sidebarResizeRef.current.currentWidth = nextWidth
    setSessionSidebarWidth(nextWidth)
  }, [chatContentWidth, position.x])

  const handleSidebarResizeEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!sidebarResizeRef.current.resizing) return
    sidebarResizeRef.current.resizing = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    void window.electronAPI.db.setState(SESSION_SIDEBAR_WIDTH_STATE_KEY, String(sidebarResizeRef.current.currentWidth))
  }, [])

  const handleContentResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    contentResizeRef.current = { resizing: true, startX: event.screenX, startWidth: chatContentWidth, currentWidth: chatContentWidth }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [chatContentWidth])

  const handleContentResizeMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!contentResizeRef.current.resizing) return
    const requested = contentResizeRef.current.startWidth + event.screenX - contentResizeRef.current.startX
    const nextWidth = normalizeChatContentWidth(requested, window.innerWidth - position.x, sidebarOccupiesSpace ? sessionSidebarWidth : 0)
    contentResizeRef.current.currentWidth = nextWidth
    setChatContentWidth(nextWidth)
  }, [position.x, sessionSidebarWidth, sidebarOccupiesSpace])

  const handleContentResizeEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!contentResizeRef.current.resizing) return
    contentResizeRef.current.resizing = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (contentResizeRef.current.currentWidth < CHAT_CONTENT_MIN_WIDTH) return
    void window.electronAPI.db.setState(CHAT_CONTENT_WIDTH_STATE_KEY, String(contentResizeRef.current.currentWidth))
  }, [])

  return {
    panelHeight,
    sessionSidebarWidth,
    chatContentWidth,
    handlePanelResizeStart,
    handlePanelResizeMove,
    handlePanelResizeEnd,
    handleSidebarResizeStart,
    handleSidebarResizeMove,
    handleSidebarResizeEnd,
    handleContentResizeStart,
    handleContentResizeMove,
    handleContentResizeEnd
  }
}
