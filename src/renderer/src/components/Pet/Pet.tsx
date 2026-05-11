import { useRef, useCallback, useEffect, useState } from 'react'
import PetSvg from './PetSvg'
import { PetState } from '../../shared/types'
import { SNAP_DISTANCE } from '../../shared/constants'
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [snapping, setSnapping] = useState(false)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      isDragging.current = true
      hasDragged.current = false
      setSnapping(false)
      dragOffset.current = {
        x: e.clientX - position.x,
        y: e.clientY - position.y
      }
      e.preventDefault()
    },
    [position]
  )

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  useEffect(() => {
    if (!contextMenu) return
    const dismiss = () => setContextMenu(null)
    window.addEventListener('click', dismiss)
    window.addEventListener('contextmenu', dismiss)
    return () => {
      window.removeEventListener('click', dismiss)
      window.removeEventListener('contextmenu', dismiss)
    }
  }, [contextMenu])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      hasDragged.current = true
      const x = e.clientX - dragOffset.current.x
      const y = e.clientY - dragOffset.current.y
      onPositionChange({ x, y })
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (!isDragging.current) return
      isDragging.current = false

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
      else if (x + 80 > screenW - SNAP_DISTANCE) { x = screenW - 80; didSnap = true }
      if (y < SNAP_DISTANCE) { y = 0; didSnap = true }
      else if (y + 80 > screenH - SNAP_DISTANCE) { y = screenH - 80; didSnap = true }

      if (didSnap) {
        setSnapping(true)
        setTimeout(() => setSnapping(false), 200)
      }
      onPositionChange({ x, y })
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [onPositionChange, onClick])

  return (
    <>
      <div
        className={`pet-container pet-state-${state}${snapping ? ' pet-snapping' : ''}`}
        style={{ left: position.x, top: position.y }}
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => window.electronAPI.setIgnoreMouseEvents(false)}
        onMouseLeave={() => {
          if (!isDragging.current && !contextMenu) {
            window.electronAPI.setIgnoreMouseEvents(true)
          }
        }}
      >
        <PetSvg state={state} />
      </div>
      {contextMenu && (
        <div
          className="pet-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseEnter={() => window.electronAPI.setIgnoreMouseEvents(false)}
          onMouseLeave={() => window.electronAPI.setIgnoreMouseEvents(true)}
        >
          <button onClick={() => { setContextMenu(null); onOpenSettings() }}>设置</button>
          <button onClick={() => { setContextMenu(null); window.close() }}>退出</button>
        </div>
      )}
    </>
  )
}
