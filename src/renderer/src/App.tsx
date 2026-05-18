import { useState, useEffect, useCallback, useRef } from 'react'
import Pet from './components/Pet/Pet'
import ChatPanel from './components/ChatPanel/ChatPanel'
import ScreenCapture from './components/ScreenCapture/ScreenCapture'
import { PetState } from './shared/types'
import { PANEL_WIDTH } from './shared/constants'
import { proactiveEngine } from './core/proactive'

function App() {
  const [petPosition, setPetPosition] = useState({ x: window.innerWidth - 180, y: window.innerHeight - 180 })
  const [positionLoaded, setPositionLoaded] = useState(false)
  const [panelVisible, setPanelVisible] = useState(false)
  const [panelPosition, setPanelPosition] = useState<{ x: number; y: number } | null>(null)
  const [panelInitialized, setPanelInitialized] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [petState, setPetState] = useState<PetState>('idle')
  const [screenshotImage, setScreenshotImage] = useState<string | null>(null)
  const [activePluginId, setActivePluginId] = useState<string | null>(null)
  const [clipboardText, setClipboardText] = useState<string | null>(null)
  const [proactiveMsg, setProactiveMsg] = useState<string | null>(null)
  const [pendingDrop, setPendingDrop] = useState<{ type: 'image' | 'text'; data: string; name: string } | null>(null)
  const [pendingClipboardMsg, setPendingClipboardMsg] = useState<string | null>(null)
  const screenshotCallbackRef = useRef<((dataUrl: string) => void) | null>(null)
  const ignoreRef = useRef(true)

  useEffect(() => {
    window.electronAPI.db.getState('pet-position').then((val) => {
      if (val) {
        try { setPetPosition(JSON.parse(val)) } catch {}
      }
    }).catch(() => {}).finally(() => setPositionLoaded(true))
  }, [])

  // Clipboard watcher
  useEffect(() => {
    const cleanup = window.electronAPI.onClipboardChange((text) => {
      if (text.length > 0 && text.length <= 500) {
        setClipboardText(text)
      }
    })
    return cleanup
  }, [])

  // Auto-dismiss clipboard toast after 5s
  useEffect(() => {
    if (!clipboardText) return
    const t = setTimeout(() => setClipboardText(null), 5000)
    return () => clearTimeout(t)
  }, [clipboardText])

  // Proactive engine
  useEffect(() => {
    proactiveEngine.start((msg) => {
      setProactiveMsg(msg)
    })
    return () => proactiveEngine.stop()
  }, [])

  // Auto-dismiss proactive message after 8s
  useEffect(() => {
    if (!proactiveMsg) return
    const t = setTimeout(() => setProactiveMsg(null), 8000)
    return () => clearTimeout(t)
  }, [proactiveMsg])

  useEffect(() => {
    let rafId: number | null = null
    let lastX = 0
    let lastY = 0

    const handleMouseMove = (e: MouseEvent) => {
      // Skip if barely moved (within 4px)
      if (Math.abs(e.clientX - lastX) < 4 && Math.abs(e.clientY - lastY) < 4) return
      lastX = e.clientX
      lastY = e.clientY

      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        if ((window as any).__petDragging) return
        const el = document.elementFromPoint(lastX, lastY)
        const isOverUI = el && el.closest('[data-interactive]')
        if (isOverUI && ignoreRef.current) {
          ignoreRef.current = false
          window.electronAPI.setIgnoreMouseEvents(false)
        } else if (!isOverUI && !ignoreRef.current) {
          ignoreRef.current = true
          window.electronAPI.setIgnoreMouseEvents(true)
        }
      })
    }
    document.addEventListener('mousemove', handleMouseMove)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
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
    proactiveEngine.userActivity()
    setPanelVisible((v) => {
      if (!v) {
        if (!panelInitialized) setPanelInitialized(true)
        setPanelPosition(calcPanelPosition(petPosition))
        window.focus()
      }
      return !v
    })
  }, [petPosition, calcPanelPosition, panelInitialized])

  const openSettings = useCallback(() => {
    setPanelPosition(calcPanelPosition(petPosition, 360))
    setPanelVisible(true)
    setPanelInitialized(true)
    setShowSettings(true)
  }, [petPosition, calcPanelPosition])

  useEffect(() => {
    const cleanup = window.electronAPI.onTogglePanel(togglePanel)
    return cleanup
  }, [togglePanel])

  useEffect(() => {
    const cleanup = window.electronAPI.onHidePanel(() => {
      setPanelVisible(false)
    })
    return cleanup
  }, [])

  useEffect(() => {
    const cleanup = window.electronAPI.onOpenSettings(openSettings)
    return cleanup
  }, [openSettings])

  useEffect(() => {
    const cleanup = window.electronAPI.onPluginHotkey((pluginId) => {
      if (!panelInitialized) setPanelInitialized(true)
      setPanelPosition(calcPanelPosition(petPosition))
      setPanelVisible(true)
      setActivePluginId(pluginId)
      window.focus()
    })
    return cleanup
  }, [petPosition, calcPanelPosition, panelInitialized])

  const startScreenshot = useCallback((hidePanel: boolean, callback: (dataUrl: string) => void) => {
    screenshotCallbackRef.current = callback
    window.electronAPI.takeScreenshot(hidePanel).then((dataUrl) => {
      if (dataUrl) {
        window.electronAPI.setIgnoreMouseEvents(false)
        setScreenshotImage(dataUrl)
      }
    })
  }, [])

  const handleScreenshotCapture = useCallback((croppedDataUrl: string) => {
    setScreenshotImage(null)
    ignoreRef.current = true
    window.electronAPI.setIgnoreMouseEvents(true)
    screenshotCallbackRef.current?.(croppedDataUrl)
    screenshotCallbackRef.current = null
  }, [])

  const handleScreenshotCancel = useCallback(() => {
    setScreenshotImage(null)
    ignoreRef.current = true
    window.electronAPI.setIgnoreMouseEvents(true)
    screenshotCallbackRef.current = null
  }, [])

  const handleFileDrop = useCallback((file: { type: 'image' | 'text'; data: string; name: string }) => {
    setPendingDrop(file)
    // Open panel with the file attached
    if (!panelInitialized) setPanelInitialized(true)
    setPanelPosition(calcPanelPosition(petPosition))
    setPanelVisible(true)
    window.focus()
  }, [petPosition, calcPanelPosition, panelInitialized])

  const handleClipboardAction = useCallback((action: 'translate' | 'summarize' | 'ask') => {
    const text = clipboardText
    setClipboardText(null)
    if (!text) return

    let msg = ''
    if (action === 'translate') msg = `请翻译以下内容：\n\n${text}`
    else if (action === 'summarize') msg = `请总结以下内容：\n\n${text}`
    else msg = text

    setPendingClipboardMsg(msg)
    if (!panelInitialized) setPanelInitialized(true)
    setPanelPosition(calcPanelPosition(petPosition))
    setPanelVisible(true)
    window.focus()
  }, [clipboardText, petPosition, calcPanelPosition, panelInitialized])

  useEffect(() => {
    if (positionLoaded) {
      window.electronAPI.db.setState('pet-position', JSON.stringify(petPosition))
    }
  }, [petPosition, positionLoaded])

  return (
    <div className="app-container">
      <Pet
        position={petPosition}
        onPositionChange={setPetPosition}
        onClick={togglePanel}
        onOpenSettings={openSettings}
        state={petState}
        onFileDrop={handleFileDrop}
      />
      {/* Proactive message bubble */}
      {proactiveMsg && (
        <div
          data-interactive
          className="pet-bubble proactive-bubble"
          style={{ left: petPosition.x + 90, top: petPosition.y - 10 }}
          onClick={() => setProactiveMsg(null)}
        >
          {proactiveMsg}
        </div>
      )}
      {/* Clipboard toast */}
      {clipboardText && (
        <div
          data-interactive
          className="pet-bubble clipboard-bubble"
          style={{ left: petPosition.x + 90, top: petPosition.y + 20 }}
        >
          <div className="clipboard-bubble-text">{clipboardText.length > 60 ? clipboardText.slice(0, 60) + '...' : clipboardText}</div>
          <div className="clipboard-bubble-actions">
            <button onClick={() => handleClipboardAction('translate')}>翻译</button>
            <button onClick={() => handleClipboardAction('summarize')}>总结</button>
            <button onClick={() => setClipboardText(null)}>✕</button>
          </div>
        </div>
      )}
      {panelInitialized && panelPosition && (
        <ChatPanel
          visible={panelVisible}
          position={panelPosition}
          onPositionChange={setPanelPosition}
          petState={petState}
          onPetStateChange={setPetState}
          onHide={() => setPanelVisible(false)}
          onClose={() => { setPanelVisible(false); setPanelInitialized(false) }}
          initialShowSettings={showSettings}
          onSettingsClose={() => setShowSettings(false)}
          onScreenshot={startScreenshot}
          initialPluginId={activePluginId}
          onPluginIdConsumed={() => setActivePluginId(null)}
          pendingAttachment={pendingDrop}
          onPendingAttachmentConsumed={() => setPendingDrop(null)}
          pendingMessage={pendingClipboardMsg}
          onPendingMessageConsumed={() => setPendingClipboardMsg(null)}
        />
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
