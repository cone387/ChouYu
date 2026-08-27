import { useState, useEffect, useCallback, useRef } from 'react'
import Pet from './components/Pet/Pet'
import ChatPanel from './components/ChatPanel/ChatPanel'
import ScreenCapture from './components/ScreenCapture/ScreenCapture'
import { AppConfig, PetState } from './shared/types'
import { DEFAULT_CONFIG, PANEL_COMPACT_HEIGHT, PANEL_SETTINGS_HEIGHT, PANEL_SETTINGS_WIDTH, PANEL_WIDTH } from './shared/constants'
import { proactiveEngine } from './core/proactive'
import { stateMachine } from './core/state-machine'

function App() {
  const [petPosition, setPetPosition] = useState({ x: window.innerWidth - 180, y: window.innerHeight - 180 })
  const [positionLoaded, setPositionLoaded] = useState(false)
  const [panelVisible, setPanelVisible] = useState(false)
  const [panelPosition, setPanelPosition] = useState<{ x: number; y: number } | null>(null)
  const [panelInitialized, setPanelInitialized] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [petState, setPetState] = useState<PetState>(stateMachine.getState())
  const [screenshotImage, setScreenshotImage] = useState<string | null>(null)
  const [activePluginId, setActivePluginId] = useState<string | null>(null)
  const [clipboardText, setClipboardText] = useState<string | null>(null)
  const [proactiveMsg, setProactiveMsg] = useState<string | null>(null)
  const [pendingDrop, setPendingDrop] = useState<{ type: 'image' | 'text'; data: string; name: string } | null>(null)
  const [pendingClipboardMsg, setPendingClipboardMsg] = useState<string | null>(null)
  const [fileDropError, setFileDropError] = useState<string | null>(null)
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const screenshotCallbackRef = useRef<((dataUrl: string) => void) | null>(null)
  const ignoreRef = useRef(true)

  useEffect(() => {
    const unsubscribe = stateMachine.onStateChange(setPetState)
    stateMachine.userActivity()
    return unsubscribe
  }, [])

  useEffect(() => {
    const markActivity = () => stateMachine.userActivity()
    window.addEventListener('pointerdown', markActivity, true)
    window.addEventListener('keydown', markActivity, true)
    return () => {
      window.removeEventListener('pointerdown', markActivity, true)
      window.removeEventListener('keydown', markActivity, true)
    }
  }, [])

  useEffect(() => {
    window.electronAPI.db.getConfig().then(setConfig)
    window.electronAPI.db.getState('pet-position').then((val) => {
      if (val) {
        try { setPetPosition(JSON.parse(val)) } catch {}
      }
    }).catch(() => {}).finally(() => setPositionLoaded(true))
  }, [])

  useEffect(() => window.electronAPI.onConfigChanged(setConfig), [])

  // Keep only the desktop pet and the capture overlay floating above other apps.
  // Expanded chat/settings behave like a normal window so they do not cover work unnecessarily.
  useEffect(() => {
    window.electronAPI.setWindowAlwaysOnTop(!panelVisible || screenshotImage !== null)
  }, [panelVisible, screenshotImage])

  // Clipboard watcher - respect config
  useEffect(() => {
    if (!config.clipboardWatch) return
    const cleanup = window.electronAPI.onClipboardChange((text) => {
      if (text.length > 0 && text.length <= 500) {
        setClipboardText(text)
      }
    })
    return cleanup
  }, [config.clipboardWatch])

  // Auto-dismiss clipboard toast after 5s
  useEffect(() => {
    if (!clipboardText) return
    const t = setTimeout(() => setClipboardText(null), 5000)
    return () => clearTimeout(t)
  }, [clipboardText])

  // Proactive engine - respect config
  useEffect(() => {
    if (!config.proactiveGreeting && !config.proactiveRestReminder) return
    proactiveEngine.start((msg) => {
      setProactiveMsg(msg)
    }, { greeting: config.proactiveGreeting, restReminder: config.proactiveRestReminder })
    return () => proactiveEngine.stop()
  }, [config.proactiveGreeting, config.proactiveRestReminder])

  // Auto-dismiss proactive message after 8s
  useEffect(() => {
    if (!proactiveMsg) return
    const t = setTimeout(() => setProactiveMsg(null), 8000)
    return () => clearTimeout(t)
  }, [proactiveMsg])

  useEffect(() => {
    if (!fileDropError) return
    const timer = setTimeout(() => setFileDropError(null), 5000)
    return () => clearTimeout(timer)
  }, [fileDropError])

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

  // Disable click-through during external file drag so drop events reach Pet
  useEffect(() => {
    let dragCounter = 0
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault()
      dragCounter++
      if (dragCounter === 1) {
        ignoreRef.current = false
        window.electronAPI.setIgnoreMouseEvents(false)
      }
    }
    const onDragLeave = () => {
      dragCounter--
      if (dragCounter <= 0) {
        dragCounter = 0
        ignoreRef.current = true
        window.electronAPI.setIgnoreMouseEvents(true)
      }
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      dragCounter = 0
      // Restore click-through after a short delay (let the Pet's onDrop fire first)
      setTimeout(() => {
        ignoreRef.current = true
        window.electronAPI.setIgnoreMouseEvents(true)
      }, 100)
    }
    const onDragOver = (e: DragEvent) => {
      e.preventDefault()
    }
    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    document.addEventListener('dragover', onDragOver)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
      document.removeEventListener('dragover', onDragOver)
    }
  }, [])

  const calcPanelPosition = useCallback((petPos: { x: number; y: number }, panelH = PANEL_COMPACT_HEIGHT, panelW = PANEL_WIDTH) => {
    const screenW = window.innerWidth
    const screenH = window.innerHeight
    const petCenterX = petPos.x + config.petSize / 2
    const petCenterY = petPos.y + config.petSize / 2
    const isLeft = petCenterX <= screenW / 2
    const isTop = petCenterY < screenH / 3

    const gap = 4

    let x = isLeft
      ? petPos.x + config.petSize + gap
      : petPos.x - panelW - gap

    let y: number
    if (isTop) {
      y = petPos.y + config.petSize + gap
    } else {
      y = petPos.y - panelH - gap
    }

    // Clamp to screen
    if (x < 4) x = 4
    if (x + panelW > screenW - 4) x = screenW - panelW - 4
    if (y < 4) y = 4
    if (y + panelH > screenH - 4) y = screenH - panelH - 4

    return { x, y }
  }, [config.petSize])

  const togglePanel = useCallback(() => {
    proactiveEngine.userActivity()
    stateMachine.userActivity()
    setPanelVisible((v) => {
      if (!v) {
        if (!panelInitialized) setPanelInitialized(true)
        setPanelPosition(calcPanelPosition(petPosition))
        window.focus()
      }
      return !v
    })
  }, [petPosition, calcPanelPosition, panelInitialized])

  const restoreClickThrough = useCallback(() => {
    ignoreRef.current = true
    window.electronAPI.setIgnoreMouseEvents(true)
  }, [])

  const hidePanel = useCallback(() => {
    setPanelVisible(false)
    restoreClickThrough()
  }, [restoreClickThrough])

  const closePanel = useCallback(() => {
    setPanelVisible(false)
    setPanelInitialized(false)
    setShowSettings(false)
    restoreClickThrough()
  }, [restoreClickThrough])

  const openSettings = useCallback(() => {
    setPanelPosition(calcPanelPosition(petPosition, PANEL_SETTINGS_HEIGHT, PANEL_SETTINGS_WIDTH))
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
      hidePanel()
    })
    return cleanup
  }, [hidePanel])

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
    window.electronAPI.takeScreenshot(hidePanel)
      .then((dataUrl) => {
        if (dataUrl) {
          window.electronAPI.setIgnoreMouseEvents(false)
          setScreenshotImage(dataUrl)
          return
        }
        screenshotCallbackRef.current = null
        setFileDropError('截图失败，请稍后重试。')
      })
      .catch(() => {
        screenshotCallbackRef.current = null
        setFileDropError('截图失败，请检查系统的屏幕录制权限。')
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
    stateMachine.userActivity()
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
    stateMachine.userActivity()

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
        size={config.petSize}
        onFileDrop={handleFileDrop}
        onFileDropError={setFileDropError}
      />
      {/* Proactive message bubble */}
      {proactiveMsg && (
        <div
          data-interactive
          className="pet-bubble proactive-bubble"
          style={{ left: petPosition.x + config.petSize + 10, top: petPosition.y - 10 }}
          onClick={() => setProactiveMsg(null)}
          role="button"
          tabIndex={0}
          aria-label={`${proactiveMsg}，点击关闭`}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setProactiveMsg(null) }}
        >
          {proactiveMsg}
        </div>
      )}
      {/* Clipboard toast */}
      {clipboardText && (
        <div
          data-interactive
          className="pet-bubble clipboard-bubble"
          style={{ left: petPosition.x + config.petSize + 10, top: petPosition.y + 20 }}
          role="status"
          aria-live="polite"
        >
          <div className="clipboard-bubble-text">{clipboardText.length > 60 ? clipboardText.slice(0, 60) + '...' : clipboardText}</div>
          <div className="clipboard-bubble-actions">
            <button onClick={() => handleClipboardAction('translate')}>翻译</button>
            <button onClick={() => handleClipboardAction('summarize')}>总结</button>
            <button onClick={() => handleClipboardAction('ask')}>询问</button>
            <button onClick={() => setClipboardText(null)} aria-label="关闭剪贴板提示">✕</button>
          </div>
        </div>
      )}
      {fileDropError && (
        <div
          data-interactive
          className="pet-bubble file-error-bubble"
          style={{ left: petPosition.x + config.petSize + 10, top: petPosition.y + 20 }}
          role="alert"
        >
          <span>{fileDropError}</span>
          <button onClick={() => setFileDropError(null)} aria-label="关闭附件错误提示">✕</button>
        </div>
      )}
      {panelInitialized && panelPosition && (
        <ChatPanel
          visible={panelVisible}
          position={panelPosition}
          onPositionChange={setPanelPosition}
          petState={petState}
          onPetStateChange={(state) => stateMachine.transition(state)}
          onHide={hidePanel}
          onClose={closePanel}
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
