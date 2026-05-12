import { useRef, useState, useCallback, useEffect } from 'react'
import './ScreenCapture.css'

interface ScreenCaptureProps {
  imageDataUrl: string
  onCapture: (croppedDataUrl: string) => void
  onCancel: () => void
}

export default function ScreenCapture({ imageDataUrl, onCapture, onCancel }: ScreenCaptureProps) {
  const [drawing, setDrawing] = useState(false)
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const startRef = useRef({ x: 0, y: 0 })
  const rectRef = useRef(rect)
  rectRef.current = rect

  const handleConfirm = useCallback(() => {
    const r = rectRef.current
    if (!r || r.w < 10 || r.h < 10) {
      onCancel()
      return
    }
    const img = new Image()
    img.onload = () => {
      const scaleX = img.width / window.innerWidth
      const scaleY = img.height / window.innerHeight
      const canvas = document.createElement('canvas')
      canvas.width = r.w * scaleX
      canvas.height = r.h * scaleY
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(
        img,
        r.x * scaleX, r.y * scaleY,
        r.w * scaleX, r.h * scaleY,
        0, 0,
        canvas.width, canvas.height
      )
      onCapture(canvas.toDataURL('image/png'))
    }
    img.src = imageDataUrl
  }, [imageDataUrl, onCapture, onCancel])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') handleConfirm()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onCancel, handleConfirm])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.screen-capture-toolbar')) return
    setDrawing(true)
    startRef.current = { x: e.clientX, y: e.clientY }
    setRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 })
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!drawing) return
    const x = Math.min(e.clientX, startRef.current.x)
    const y = Math.min(e.clientY, startRef.current.y)
    const w = Math.abs(e.clientX - startRef.current.x)
    const h = Math.abs(e.clientY - startRef.current.y)
    setRect({ x, y, w, h })
  }, [drawing])

  const handleMouseUp = useCallback(() => {
    setDrawing(false)
  }, [])

  return (
    <div
      data-interactive
      className="screen-capture-overlay"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <img src={imageDataUrl} className="screen-capture-bg" draggable={false} />
      {!rect && <div className="screen-capture-mask" />}
      {rect && rect.w > 0 && rect.h > 0 && (
        <>
          <div
            className="screen-capture-selection"
            style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
          />
          {!drawing && (
            <div className="screen-capture-toolbar" style={{ left: rect.x + rect.w - 70, top: rect.y + rect.h + 8 }}>
              <button className="sc-btn sc-btn-cancel" onMouseDown={(e) => e.stopPropagation()} onClick={onCancel}>✕</button>
              <button className="sc-btn sc-btn-confirm" onMouseDown={(e) => e.stopPropagation()} onClick={handleConfirm}>✓</button>
            </div>
          )}
        </>
      )}
      <div className="screen-capture-hint">
        {!rect ? '拖动鼠标选择截图区域，Esc 取消' : drawing ? '' : '按 Enter 确认，Esc 取消'}
      </div>
    </div>
  )
}
