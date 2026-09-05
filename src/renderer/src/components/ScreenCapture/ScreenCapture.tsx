import { useRef, useState, useCallback, useEffect } from 'react'
import './ScreenCapture.css'

export interface CaptureRect {
  x: number
  y: number
  w: number
  h: number
}

interface ScreenCaptureProps {
  imageDataUrl: string
  /** `crop` returns the selected region; `scroll` hands it to the scrolling capture pipeline. */
  mode?: 'crop' | 'scroll'
  busy?: boolean
  progress?: number
  onCapture: (croppedDataUrl: string) => void
  onScrollCapture?: (rect: CaptureRect) => void
  onCancel: () => void
}

const MIN_RECT = 10

export default function ScreenCapture({
  imageDataUrl,
  mode = 'crop',
  busy = false,
  progress = 0,
  onCapture,
  onScrollCapture,
  onCancel
}: ScreenCaptureProps) {
  const [drawing, setDrawing] = useState(false)
  const [rect, setRect] = useState<CaptureRect | null>(null)
  const [error, setError] = useState('')
  const startRef = useRef({ x: 0, y: 0 })
  const rectRef = useRef(rect)
  rectRef.current = rect
  const cursorRef = useRef({ x: 0, y: 0 })
  const isScroll = mode === 'scroll'

  const handleConfirm = useCallback(() => {
    const r = rectRef.current
    if (!r || r.w < MIN_RECT || r.h < MIN_RECT) {
      onCancel()
      return
    }
    if (isScroll) {
      const { x, y } = cursorRef.current
      const inside = x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
      if (!inside) {
        setError('请把鼠标移到选区内，再按 Enter 开始滚动捕获。')
        return
      }
      setError('')
      onScrollCapture?.(r)
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
  }, [imageDataUrl, isScroll, onCapture, onCancel, onScrollCapture])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') handleConfirm()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onCancel, handleConfirm])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (busy) return
    if ((e.target as HTMLElement).closest('.screen-capture-toolbar')) return
    setDrawing(true)
    setError('')
    startRef.current = { x: e.clientX, y: e.clientY }
    setRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 })
  }, [busy])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    cursorRef.current = { x: e.clientX, y: e.clientY }
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

  const hint = busy
    ? `正在滚动捕获…已捕获 ${progress} 段，请稍候。`
    : error
      ? error
      : !rect
        ? '拖动鼠标选择区域，Esc 取消'
        : drawing
          ? ''
          : isScroll
            ? '把鼠标移到选区内，按 Enter 开始；若页面没有自动滚动，请手动滚动鼠标'
            : '按 Enter 确认，Esc 取消'

  return (
    <div
      data-interactive
      className={`screen-capture-overlay${busy ? ' is-busy' : ''}`}
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
          {!drawing && !busy && (
            <div className="screen-capture-toolbar" style={{ left: rect.x + rect.w - 70, top: rect.y + rect.h + 8 }}>
              <button className="sc-btn sc-btn-cancel" aria-label="取消截图" onMouseDown={(e) => e.stopPropagation()} onClick={onCancel}>✕</button>
              <button
                className="sc-btn sc-btn-confirm"
                aria-label={isScroll ? '开始滚动捕获' : '确认截图'}
                title={isScroll ? '开始滚动捕获' : '确认截图'}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={handleConfirm}
              >{isScroll ? '⇩' : '✓'}</button>
            </div>
          )}
        </>
      )}
      <div className={`screen-capture-hint${error ? ' is-error' : ''}${busy ? ' is-busy' : ''}`}>
        {hint}
      </div>
    </div>
  )
}
