import { useRef, useCallback, useEffect } from 'react'
import PetSvg from './PetSvg'
import { PetState } from '../../shared/types'
import { SNAP_DISTANCE } from '../../shared/constants'
import './Pet.css'

interface PetProps {
  position: { x: number; y: number }
  onPositionChange: (pos: { x: number; y: number }) => void
  onClick: () => void
  state: PetState
}

export default function Pet({ position, onPositionChange, onClick, state }: PetProps) {
  const isDragging = useRef(false)
  const hasDragged = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      isDragging.current = true
      hasDragged.current = false
      dragOffset.current = {
        x: e.clientX - position.x,
        y: e.clientY - position.y
      }
      e.preventDefault()
    },
    [position]
  )

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      hasDragged.current = true
      const newX = e.clientX - dragOffset.current.x
      const newY = e.clientY - dragOffset.current.y
      onPositionChange({ x: newX, y: newY })
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

      if (x < SNAP_DISTANCE) x = 0
      if (y < SNAP_DISTANCE) y = 0
      if (x + 80 > screenW - SNAP_DISTANCE) x = screenW - 80
      if (y + 80 > screenH - SNAP_DISTANCE) y = screenH - 80

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
    <div
      className={`pet-container pet-state-${state}`}
      style={{ left: position.x, top: position.y }}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => window.electronAPI.setIgnoreMouseEvents(false)}
      onMouseLeave={() => {
        if (!isDragging.current) {
          window.electronAPI.setIgnoreMouseEvents(true)
        }
      }}
    >
      <PetSvg state={state} />
    </div>
  )
}
