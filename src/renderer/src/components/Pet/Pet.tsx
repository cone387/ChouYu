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
  const isDragging = useRef(false)
  const hasDragged = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [snapping, setSnapping] = useState(false)

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      isDragging.current = true
      hasDragged.current = false
      setSnapping(false)
      ;(window as any).__petDragging = true
      window.electronAPI.setIgnoreMouseEvents(false)
      dragOffset.current = {
        x: e.clientX - position.x,
        y: e.clientY - position.y
      }
      containerRef.current?.setPointerCapture(e.pointerId)
      e.preventDefault()
    },
    [position]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return
      hasDragged.current = true
      const x = e.clientX - dragOffset.current.x
      const y = e.clientY - dragOffset.current.y
      onPositionChange({ x, y })
    },
    [onPositionChange]
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return
      isDragging.current = false
      ;(window as any).__petDragging = false
      containerRef.current?.releasePointerCapture(e.pointerId)

      if (!hasDragged.current) {
        onClick()
        return
      }

      let x = e.clientX - dragOffset.current.x
      let y = e.clientY - dragOffset.current.y
      const screenW = window.innerWidth
      const screenH = window.innerHeight
      let didSnap = false

      if (x < SNAP_DISTANCE) { x = 0; didSnap = true }
      else if (x + DEFAULT_PET_SIZE > screenW - SNAP_DISTANCE) { x = screenW - DEFAULT_PET_SIZE; didSnap = true }
      if (y < SNAP_DISTANCE) { y = 0; didSnap = true }
      else if (y + DEFAULT_PET_SIZE > screenH - SNAP_DISTANCE) { y = screenH - DEFAULT_PET_SIZE; didSnap = true }

      if (didSnap) {
        setSnapping(true)
        requestAnimationFrame(() => {
          onPositionChange({ x, y })
        })
        setTimeout(() => setSnapping(false), 350)
      } else {
        onPositionChange({ x, y })
      }
    },
    [onPositionChange, onClick]
  )

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
        className={`pet-container pet-state-${state}${snapping ? ' pet-snapping' : ''}`}
        style={{ left: position.x, top: position.y }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
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
