import { useRef, useCallback, useEffect, useState } from 'react'
import PetSvg from './PetSvg'
import { PetState } from '../../shared/types'
import { SNAP_DISTANCE, DEFAULT_PET_SIZE } from '../../shared/constants'
import './Pet.css'

interface PetProps {
  position: { x: number; y: number }
  onPositionChange: (pos: { x: number; y: number }) => void
  onClick: () => void
  onOpenSettings: () => void
  state: PetState
}

export default function Pet({ position, onPositionChange, onClick, onOpenSettings, state }: PetProps) {
  const draggingRef = useRef(false)
  const hasDraggedRef = useRef(false)
  const dragStartRef = useRef({ screenX: 0, screenY: 0, posX: 0, posY: 0 })
  const posRef = useRef(position)
  const containerRef = useRef<HTMLDivElement>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  posRef.current = position

  const applyPosition = useCallback((x: number, y: number, animate: boolean) => {
    const el = containerRef.current
    if (!el) return
    if (animate) {
      el.classList.add('pet-snapping')
    } else {
      el.classList.remove('pet-snapping')
    }
    el.style.left = x + 'px'
    el.style.top = y + 'px'
  }, [])

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
      applyPosition(nextX, nextY, false)
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

      if (x < SNAP_DISTANCE) { snapX = 0; didSnap = true }
      else if (x + DEFAULT_PET_SIZE > screenW - SNAP_DISTANCE) { snapX = screenW - DEFAULT_PET_SIZE; didSnap = true }
      if (y < SNAP_DISTANCE) { snapY = 0; didSnap = true }
      else if (y + DEFAULT_PET_SIZE > screenH - SNAP_DISTANCE) { snapY = screenH - DEFAULT_PET_SIZE; didSnap = true }

      if (didSnap) {
        applyPosition(snapX, snapY, true)
        posRef.current = { x: snapX, y: snapY }
        setTimeout(() => {
          containerRef.current?.classList.remove('pet-snapping')
        }, 350)
      }

      onPositionChange(posRef.current)
    }

    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
  }, [onClick, onPositionChange, applyPosition])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  useEffect(() => {
    if (!contextMenu) return
    const dismiss = () => setContextMenu(null)
    setTimeout(() => {
      window.addEventListener('mousedown', dismiss)
    }, 0)
    return () => {
      window.removeEventListener('mousedown', dismiss)
    }
  }, [contextMenu])

  return (
    <>
      <div
        ref={containerRef}
        data-interactive
        className={`pet-container pet-state-${state}`}
        style={{ left: position.x, top: position.y }}
        onPointerDown={handlePointerDown}
        onContextMenu={handleContextMenu}
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
          <button onClick={() => { setContextMenu(null); window.close() }}>退出</button>
        </div>
      )}
    </>
  )
}
