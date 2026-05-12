import { useState, useEffect, useCallback, useRef } from 'react'
import Pet from './components/Pet/Pet'
import ChatPanel from './components/ChatPanel/ChatPanel'
import ScreenCapture from './components/ScreenCapture/ScreenCapture'
import { PetState } from './shared/types'
import { PANEL_WIDTH } from './shared/constants'

function App() {
  const [petPosition, setPetPosition] = useState({ x: window.innerWidth - 180, y: window.innerHeight - 180 })
  const [positionLoaded, setPositionLoaded] = useState(false)
  const [panelVisible, setPanelVisible] = useState(false)
  const [panelPosition, setPanelPosition] = useState<{ x: number; y: number } | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [petState, setPetState] = useState<PetState>('idle')
  const [screenshotImage, setScreenshotImage] = useState<string | null>(null)
  const screenshotCallbackRef = useRef<((dataUrl: string) => void) | null>(null)
  const ignoreRef = useRef(true)

  useEffect(() => {
    window.electronAPI.db.getState('pet-position').then((val) => {
      if (val) {
        try { setPetPosition(JSON.parse(val)) } catch {}
      }
    }).catch(() => {}).finally(() => setPositionLoaded(true))
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if ((window as any).__petDragging) return
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const isOverUI = el && el.closest('[data-interactive]')
      if (isOverUI && ignoreRef.current) {
        ignoreRef.current = false
        window.electronAPI.setIgnoreMouseEvents(false)
      } else if (!isOverUI && !ignoreRef.current) {
        ignoreRef.current = true
        window.electronAPI.setIgnoreMouseEvents(true)
      }
    }
    document.addEventListener('mousemove', handleMouseMove)
    return () => document.removeEventListener('mousemove', handleMouseMove)
  }, [])

  const calcPanelPosition = useCallback((petPos: { x: number; y: number }, panelH = 140) => {
    const screenW = window.innerWidth
    const screenH = window.innerHeight
    const petCenterX = petPos.x + 40
    const petCenterY = petPos.y + 40
    const isLeft = petCenterX <= screenW / 2
    const isTop = petCenterY < screenH / 3

    const gap = 4

    let x = isLeft
      ? petPos.x + 80 + gap
      : petPos.x - PANEL_WIDTH - gap

    let y: number
    if (isTop) {
      y = petPos.y + 80 + gap
    } else {
      y = petPos.y - panelH - gap
    }

    // Clamp to screen
    if (x < 4) x = 4
    if (x + PANEL_WIDTH > screenW - 4) x = screenW - PANEL_WIDTH - 4
    if (y < 4) y = 4
    if (y + panelH > screenH - 4) y = screenH - panelH - 4

    return { x, y }
  }, [])

  const togglePanel = useCallback(() => {
    setPanelVisible((v) => {
      if (!v) {
        setPanelPosition(calcPanelPosition(petPosition))
      }
      return !v
    })
  }, [petPosition, calcPanelPosition])

  const openSettings = useCallback(() => {
    setPanelPosition(calcPanelPosition(petPosition, 360))
    setPanelVisible(true)
    setShowSettings(true)
  }, [petPosition, calcPanelPosition])

  useEffect(() => {
    const cleanup = window.electronAPI.onTogglePanel(togglePanel)
    return cleanup
  }, [togglePanel])

  useEffect(() => {
    const cleanup = window.electronAPI.onOpenSettings(openSettings)
    return cleanup
  }, [openSettings])

  const startScreenshot = useCallback((callback: (dataUrl: string) => void) => {
    screenshotCallbackRef.current = callback
    window.electronAPI.takeScreenshot().then((dataUrl) => {
      if (dataUrl) {
        window.electronAPI.setIgnoreMouseEvents(false)
        setScreenshotImage(dataUrl)
      }
    })
  }, [])

  const handleScreenshotCapture = useCallback((croppedDataUrl: string) => {
    setScreenshotImage(null)
    window.electronAPI.setIgnoreMouseEvents(true)
    screenshotCallbackRef.current?.(croppedDataUrl)
    screenshotCallbackRef.current = null
  }, [])

  const handleScreenshotCancel = useCallback(() => {
    setScreenshotImage(null)
    window.electronAPI.setIgnoreMouseEvents(true)
    screenshotCallbackRef.current = null
  }, [])

  useEffect(() => {
    if (positionLoaded) {
      window.electronAPI.db.setState('pet-position', JSON.stringify(petPosition))
    }
  }, [petPosition, positionLoaded])

  return (
    <div className="app-container">
      {!screenshotImage && (
        <>
          <Pet
            position={petPosition}
            onPositionChange={setPetPosition}
            onClick={togglePanel}
            onOpenSettings={openSettings}
            state={petState}
          />
          {panelVisible && panelPosition && (
            <ChatPanel
              position={panelPosition}
              onPositionChange={setPanelPosition}
              petState={petState}
              onPetStateChange={setPetState}
              onClose={() => setPanelVisible(false)}
              initialShowSettings={showSettings}
              onSettingsClose={() => setShowSettings(false)}
              onScreenshot={startScreenshot}
            />
          )}
        </>
      )}
      {screenshotImage && (
        <ScreenCapture
          imageDataUrl={screenshotImage}
          onCapture={handleScreenshotCapture}
          onCancel={handleScreenshotCancel}
        />
      )}
    </div>
  )
}

export default App
