import { useRef, useCallback, useEffect, useState } from 'react'
import PetSvg from './PetSvg'
import { PetState } from '../../shared/types'
import { SNAP_DISTANCE } from '../../shared/constants'
import { getAttachmentValidationError, readAttachmentFile } from '../../core/attachments'
import './Pet.css'

interface PetProps {
  position: { x: number; y: number }
  onPositionChange: (pos: { x: number; y: number }) => void
  onClick: () => void
  onOpenSettings: () => void
  state: PetState
  size: number
  onFileDrop?: (file: { type: 'image' | 'text'; data: string; name: string }) => void
  onFileDropError?: (message: string) => void
}

export default function Pet({ position, onPositionChange, onClick, onOpenSettings, state, size, onFileDrop, onFileDropError }: PetProps) {
  const draggingRef = useRef(false)
  const hasDraggedRef = useRef(false)
  const dragStartRef = useRef({ screenX: 0, screenY: 0, posX: 0, posY: 0 })
  const posRef = useRef(position)
  const containerRef = useRef<HTMLDivElement>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const applyPosition = useCallback((x: number, y: number) => {
    const el = containerRef.current
    if (!el) return
    el.style.left = x + 'px'
    el.style.top = y + 'px'
  }, [])

  // Sync DOM position when prop changes (e.g. from DB load)
  useEffect(() => {
    if (!draggingRef.current) {
      applyPosition(position.x, position.y)
      posRef.current = position
    }
  }, [position.x, position.y, applyPosition])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()

    draggingRef.current = false
    hasDraggedRef.current = false
    ;(window as any).__petDragging = true
    window.electronAPI.setIgnoreMouseEvents(false)

    dragStartRef.current = {
      screenX: e.screenX,
      screenY: e.screenY,
      posX: posRef.current.x,
      posY: posRef.current.y
    }

    const onMove = (ev: PointerEvent) => {
      const dx = ev.screenX - dragStartRef.current.screenX
      const dy = ev.screenY - dragStartRef.current.screenY
      if (!draggingRef.current && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        draggingRef.current = true
        hasDraggedRef.current = true
      }
      if (!draggingRef.current) return

      const nextX = dragStartRef.current.posX + dx
      const nextY = dragStartRef.current.posY + dy
      applyPosition(nextX, nextY)
      posRef.current = { x: nextX, y: nextY }
    }

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      ;(window as any).__petDragging = false

      if (!hasDraggedRef.current) {
        onClick()
        return
      }

      const { x, y } = posRef.current
      const screenW = window.innerWidth
      const screenH = window.innerHeight
      let snapX = x
      let snapY = y
      let didSnap = false

      if (x < SNAP_DISTANCE) { snapX = -(size / 2); didSnap = true }
      else if (x + size > screenW - SNAP_DISTANCE) { snapX = screenW - size / 2; didSnap = true }
      if (y < SNAP_DISTANCE) { snapY = -(size / 2); didSnap = true }
      else if (y + size > screenH - SNAP_DISTANCE) { snapY = screenH - size / 2; didSnap = true }

      if (didSnap) {
        const el = containerRef.current!
        const dx = snapX - x
        const dy = snapY - y
        // Set final position immediately
        el.style.left = snapX + 'px'
        el.style.top = snapY + 'px'
        // Animate from old to new using transform (GPU-composited, always works)
        el.animate(
          [
            { transform: `translate(${-dx}px, ${-dy}px)` },
            { transform: 'translate(0, 0)' }
          ],
          { duration: 300, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
        )
        posRef.current = { x: snapX, y: snapY }
      }

      onPositionChange(posRef.current)
    }

    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
  }, [onClick, onPositionChange, applyPosition, size])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const menuW = 120
    const menuH = 80
    let x = e.clientX
    let y = e.clientY
    if (x + menuW > window.innerWidth) x = window.innerWidth - menuW - 4
    if (y + menuH > window.innerHeight) y = window.innerHeight - menuH - 4
    if (x < 4) x = 4
    if (y < 4) y = 4
    setContextMenu({ x, y })
  }, [])

  useEffect(() => {
    if (!contextMenu) return
    const dismiss = (e: PointerEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('.pet-context-menu')) return
      setContextMenu(null)
    }
    window.addEventListener('pointerdown', dismiss, true)
    return () => {
      window.removeEventListener('pointerdown', dismiss, true)
    }
  }, [contextMenu])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    const file = files[0]
    const validationError = getAttachmentValidationError(file)
    if (validationError) {
      onFileDropError?.(validationError)
      return
    }
    void readAttachmentFile(file)
      .then((attachment) => onFileDrop?.(attachment))
      .catch((error) => onFileDropError?.(error instanceof Error ? error.message : '附件读取失败'))
  }, [onFileDrop, onFileDropError])

  const dragCounterRef = useRef(0)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0
      setDragOver(false)
    }
  }, [])

  return (
    <>
      <div
        ref={containerRef}
        data-interactive
        role="button"
        tabIndex={0}
        aria-label="ChouYu 桌面宠物，按 Enter 打开聊天"
        className={`pet-container pet-state-${state}${dragOver ? ' pet-drop-target' : ''}`}
        style={{ width: size, height: size }}
        onPointerDown={handlePointerDown}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick()
          }
        }}
        onContextMenu={handleContextMenu}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
      >
        <PetSvg state={state} />
      </div>
      {contextMenu && (
        <div
          data-interactive
          className="pet-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button onClick={() => { setContextMenu(null); onOpenSettings() }}>设置</button>
          <button onClick={() => { setContextMenu(null); void window.electronAPI.quitApp() }}>退出</button>
        </div>
      )}
    </>
  )
}
