import type { AssistantMessageKind } from '../../shared/assistant-message'
import type { TaskConversionDraft, TaskNavigation } from './components/Tasks/taskNavigation'
import { useState, useEffect, useCallback, useRef } from 'react'
import StorageNotice from './components/StorageNotice/StorageNotice'
import Pet from './components/Pet/Pet'
import ChatPanel from './components/ChatPanel/ChatPanel'
import type { WorkspacePage } from './components/Workspace/WorkspaceNav'
import ScreenCapture from './components/ScreenCapture/ScreenCapture'
import { AppConfig, PetState } from './shared/types'
import { DEFAULT_CONFIG, PANEL_WIDTH } from './shared/constants'
import { proactiveEngine } from './core/proactive'
import { stateMachine } from './core/state-machine'
import { getCenteredPanelPosition } from './core/panel-position'
import { getDefaultPanelHeight } from './core/panel-state'

function App() {
  const [petPosition, setPetPosition] = useState({ x: window.innerWidth - 180, y: window.innerHeight - 180 })
  const [petVisible, setPetVisible] = useState(true)
  const [positionLoaded, setPositionLoaded] = useState(false)
  const [panelVisible, setPanelVisible] = useState(false)
  const [panelPosition, setPanelPosition] = useState<{ x: number; y: number } | null>(null)
  const [panelInitialized, setPanelInitialized] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [workspaceRequest, setWorkspaceRequest] = useState<{ page: WorkspacePage; id: number; taskId?: string; taskDraft?: TaskConversionDraft }>()
  const [petState, setPetState] = useState<PetState>(stateMachine.getState())
  const [screenshotImage, setScreenshotImage] = useState<string | null>(null)
  const [captureMode, setCaptureMode] = useState<'crop' | 'scroll'>('crop')
  const [scrollCaptureBusy, setScrollCaptureBusy] = useState(false)
  const [scrollCaptureProgress, setScrollCaptureProgress] = useState(0)
  const [activePluginId, setActivePluginId] = useState<string | null>(null)
  const [clipboardText, setClipboardText] = useState<string | null>(null)
  const [assistantUnread, setAssistantUnread] = useState(0)
  const [assistantFocusRequest, setAssistantFocusRequest] = useState(0)
  const [pendingDrop, setPendingDrop] = useState<{ type: 'image' | 'text'; data: string; name: string } | null>(null)
  const [pendingClipboardMsg, setPendingClipboardMsg] = useState<string | null>(null)
  const [fileDropError, setFileDropError] = useState<string | null>(null)
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const screenshotCallbackRef = useRef<((dataUrl: string) => void) | null>(null)
  const ignoreRef = useRef(true)

  useEffect(() => {
    const clampPet = () => setPetPosition((position) => ({
      x: Math.min(Math.max(0, position.x), Math.max(0, window.innerWidth - config.petSize)),
      y: Math.min(Math.max(0, position.y), Math.max(0, window.innerHeight - config.petSize))
    }))
    window.addEventListener('resize', clampPet)
    return () => window.removeEventListener('resize', clampPet)
  }, [config.petSize])

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
    Promise.all([
      window.electronAPI.db.getState('pet-position'),
      window.electronAPI.db.getState('panel-position'),
      window.electronAPI.db.getState('pet-visible')
    ]).then(([petValue, panelValue, petVisibleValue]) => {
      if (petValue) {
        try { setPetPosition(JSON.parse(petValue)) } catch {}
      }
      if (panelValue) {
        try {
          const parsed = JSON.parse(panelValue)
          if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) {
            setPanelPosition({ x: parsed.x, y: parsed.y })
          }
        } catch {}
      }
      if (petVisibleValue !== null) {
        const visible = petVisibleValue !== 'false'
        setPetVisible(visible)
        window.electronAPI.notifyPetVisible(visible)
      }
    }).catch(() => {}).finally(() => {
      setPositionLoaded(true)
    })
  }, [])

  useEffect(() => window.electronAPI.onConfigChanged(setConfig), [])

  const updatePetVisibility = useCallback((visible: boolean) => {
    setPetVisible(visible)
    void window.electronAPI.db.setState('pet-visible', String(visible)).catch(() => { /* The persistent storage notice reports disk failures. */ })
    window.electronAPI.notifyPetVisible(visible)
  }, [])

  useEffect(() => window.electronAPI.onSetPetVisible(updatePetVisibility), [updatePetVisibility])

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
    const append = (message: string, kind?: AssistantMessageKind) => {
      void window.electronAPI.proactiveAppend(message, undefined, kind).catch(() => { /* storage notice covers persistence failures */ })
    }
    proactiveEngine.start((msg, kind) => {
      if (kind === 'return') {
        const now = new Date()
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
        const to = Date.now()
        const from = to - 30 * 60_000
        void Promise.all([
          window.electronAPI.journal.overview({ from: start, to }),
          window.electronAPI.journal.list({ from, to, offset: 0 })
        ]).then(([day, recent]) => {
          const titles = [...new Set(recent.items.map(item => item.title.trim()).filter(Boolean))].slice(0, 3)
          const where = titles.length ? `刚才停在：${titles.join('、')}。` : ''
          append(day.activityCount > 0
            ? `欢迎回来。今天已经记录 ${day.activityCount} 段工作。${where}要接着刚才的工作吗？`
            : `欢迎回来。${where}要接着刚才的工作吗？`, 'return')
        }).catch(() => append(msg, 'return'))
      } else {
        append(msg, kind)
      }
    }, { greeting: config.proactiveGreeting, restReminder: config.proactiveRestReminder })
    void window.electronAPI.db.getState('assistant-snoozes').then(value => {
      if (!value) return
      try { proactiveEngine.restoreSnoozes(JSON.parse(value)) } catch { /* ignore malformed snooze history */ }
    }).catch(() => {})
    return () => proactiveEngine.stop()
  }, [config.proactiveGreeting, config.proactiveRestReminder])

  // 助手未读驱动宠物红点；托盘由主进程驱动。
  useEffect(() => {
    void window.electronAPI.getAssistantUnread().then(setAssistantUnread).catch(() => {})
    return window.electronAPI.onAssistantUnread(setAssistantUnread)
  }, [])

  // Task reminders from the main-process scheduler land in the assistant session.
  useEffect(() => {
    const cleanup = window.electronAPI.tasks.onTasksReminder(payload => {
      if ('task' in payload) void window.electronAPI.proactiveAppend(`任务提醒：${payload.task.title}`, undefined, 'task')
      else if (payload.backlog > 0) void window.electronAPI.proactiveAppend(`错过了 ${payload.backlog} 条任务提醒`, undefined, 'task-backlog')
    })
    const rebuiltCleanup = window.electronAPI.tasks.onTasksStoreRebuilt(() => {
      void window.electronAPI.proactiveAppend('任务数据文件无法读取，已重建空库，原文件已隔离保存。', undefined, 'warning')
    })
    window.electronAPI.tasks.ready()
    return () => { cleanup(); rebuiltCleanup() }
  }, [])

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

  const getDefaultPanelPosition = useCallback((panelH = getDefaultPanelHeight(window.innerHeight), panelW = PANEL_WIDTH) => {
    return getCenteredPanelPosition(
      { width: panelW, height: panelH },
      { width: window.innerWidth, height: window.innerHeight }
    )
  }, [])

  const handlePanelPositionChange = useCallback((position: { x: number; y: number }) => {
    setPanelPosition(position)
    void window.electronAPI.db.setState('panel-position', JSON.stringify(position)).catch(() => { /* The persistent storage notice reports disk failures. */ })
  }, [])

  const ensurePanelPosition = useCallback((panelH?: number, panelW?: number) => {
    setPanelPosition((current) => current ?? getDefaultPanelPosition(panelH, panelW))
  }, [getDefaultPanelPosition])

  const togglePanel = useCallback(() => {
    proactiveEngine.userActivity()
    stateMachine.userActivity()
    setPanelVisible((v) => {
      if (!v) {
        if (!panelInitialized) setPanelInitialized(true)
        ensurePanelPosition()
        window.focus()
      }
      return !v
    })
  }, [ensurePanelPosition, panelInitialized])

  const openChatPanel = useCallback(() => {
    proactiveEngine.userActivity()
    stateMachine.userActivity()
    if (!panelInitialized) setPanelInitialized(true)
    ensurePanelPosition()
    setShowSettings(false)
    setPanelVisible(true)
    window.focus()
  }, [ensurePanelPosition, panelInitialized])

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
    setWorkspaceRequest(undefined)
    setAssistantFocusRequest(0)
    setShowSettings(false)
    restoreClickThrough()
  }, [restoreClickThrough])

  const openSettings = useCallback(() => {
    ensurePanelPosition()
    setPanelVisible(true)
    setPanelInitialized(true)
    setShowSettings(true)
    setWorkspaceRequest(previous => ({ page: 'settings', id: (previous?.id ?? 0) + 1 }))
  }, [ensurePanelPosition])

  const openTasksPage = useCallback((taskId?: string) => {
    ensurePanelPosition()
    setPanelVisible(true)
    setPanelInitialized(true)
    setShowSettings(false)
    setWorkspaceRequest(previous => ({ page: 'tasks', id: (previous?.id ?? 0) + 1, ...(taskId ? { taskId } : {}) }))
    window.focus()
  }, [ensurePanelPosition])

  useEffect(() => window.electronAPI.onOpenJournalPanel(() => {
    ensurePanelPosition()
    setPanelVisible(true)
    setPanelInitialized(true)
    setShowSettings(false)
    setWorkspaceRequest(previous => ({ page: 'journal', id: (previous?.id ?? 0) + 1 }))
    window.focus()
  }), [ensurePanelPosition])

  useEffect(() => window.electronAPI.tasks.onOpenTasksPanel(openTasksPage), [openTasksPage])
  useEffect(() => {
    const onTask = (event: Event) => {
      const detail = (event as CustomEvent<TaskNavigation>).detail
      openTasksPage(detail.taskId)
      if (detail.draft) setWorkspaceRequest(previous => ({ page: 'tasks', id: (previous?.id ?? 0) + 1, taskDraft: detail.draft }))
    }
    window.addEventListener('chouyu:task-navigation', onTask)
    return () => window.removeEventListener('chouyu:task-navigation', onTask)
  }, [openTasksPage])

  useEffect(() => {
    const cleanup = window.electronAPI.onTogglePanel(togglePanel)
    return cleanup
  }, [togglePanel])

  useEffect(() => {
    const cleanup = window.electronAPI.onOpenChatPanel(openChatPanel)
    return cleanup
  }, [openChatPanel])

  useEffect(() => {
    const cleanup = window.electronAPI.onOpenAssistantChat(() => {
      openChatPanel()
      setAssistantFocusRequest(current => current + 1)
    })
    return cleanup
  }, [openChatPanel])

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
      ensurePanelPosition()
      setPanelVisible(true)
      setActivePluginId(pluginId)
      window.focus()
    })
    return cleanup
  }, [ensurePanelPosition, panelInitialized])

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
    setCaptureMode('crop')
    ignoreRef.current = true
    window.electronAPI.setIgnoreMouseEvents(true)
    screenshotCallbackRef.current = null
  }, [])

  const startScrollScreenshot = useCallback((callback: (dataUrl: string) => void) => {
    setScrollCaptureBusy(false)
    setScrollCaptureProgress(0)
    setCaptureMode('scroll')
    screenshotCallbackRef.current = callback
    window.electronAPI.takeScreenshot(true)
      .then((dataUrl) => {
        if (dataUrl) {
          window.electronAPI.setIgnoreMouseEvents(false)
          setScreenshotImage(dataUrl)
          return
        }
        screenshotCallbackRef.current = null
        setCaptureMode('crop')
        setFileDropError('截图失败，请稍后重试。')
      })
      .catch(() => {
        screenshotCallbackRef.current = null
        setCaptureMode('crop')
        setFileDropError('截图失败，请检查系统的屏幕录制权限。')
      })
  }, [])

  const finishScrollCapture = useCallback((dataUrl?: string, error?: string) => {
    setScrollCaptureBusy(false)
    setScrollCaptureProgress(0)
    setScreenshotImage(null)
    setCaptureMode('crop')
    ignoreRef.current = true
    window.electronAPI.setIgnoreMouseEvents(true)
    const callback = screenshotCallbackRef.current
    screenshotCallbackRef.current = null
    if (dataUrl) callback?.(dataUrl)
    else if (error) setFileDropError(error)
  }, [])

  const handleScrollCapture = useCallback((rect: { x: number; y: number; w: number; h: number }) => {
    setScrollCaptureBusy(true)
    setScrollCaptureProgress(0)
    window.electronAPI.captureScrollRegion({ x: rect.x, y: rect.y, width: rect.w, height: rect.h })
      .then((result) => {
        if (result?.dataUrl) {
          finishScrollCapture(result.dataUrl)
          return
        }
        finishScrollCapture(undefined, result?.error || '滚动截图失败，请重试。')
      })
      .catch(() => {
        finishScrollCapture(undefined, '滚动截图失败，请稍后重试。')
      })
  }, [finishScrollCapture])

  useEffect(() => {
    if (!scrollCaptureBusy) return
    return window.electronAPI.onScrollCaptureProgress((info) => {
      setScrollCaptureProgress(info.frames)
    })
  }, [scrollCaptureBusy])

  const handleFileDrop = useCallback((file: { type: 'image' | 'text'; data: string; name: string }) => {
    stateMachine.userActivity()
    setPendingDrop(file)
    // Open panel with the file attached
    if (!panelInitialized) setPanelInitialized(true)
    ensurePanelPosition()
    setPanelVisible(true)
    window.focus()
  }, [ensurePanelPosition, panelInitialized])

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
    ensurePanelPosition()
    setPanelVisible(true)
    window.focus()
  }, [clipboardText, ensurePanelPosition, panelInitialized])

  useEffect(() => {
    if (positionLoaded) {
      window.electronAPI.db.setState('pet-position', JSON.stringify(petPosition)).catch(() => { /* The persistent storage notice reports disk failures. */ })
    }
  }, [petPosition, positionLoaded])

  return (
    <div className="app-container">
      <StorageNotice />
      {petVisible && (
        <Pet
          position={petPosition}
          onPositionChange={setPetPosition}
          onClick={togglePanel}
          onOpenSettings={openSettings}
          onOpenAssistantChat={() => {
            openChatPanel()
            setAssistantFocusRequest(current => current + 1)
          }}
          state={petState}
          size={config.petSize}
          onFileDrop={handleFileDrop}
          onFileDropError={setFileDropError}
          hasUnread={assistantUnread > 0}
        />
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
          onPositionChange={handlePanelPositionChange}
          petState={petState}
          onPetStateChange={(state) => stateMachine.transition(state)}
          onHide={hidePanel}
          onClose={closePanel}
          petVisible={petVisible}
          onPetVisibleChange={updatePetVisibility}
          initialShowSettings={showSettings}
          workspaceRequest={workspaceRequest}
          onSettingsClose={() => setShowSettings(false)}
          onScreenshot={startScreenshot}
          onScrollScreenshot={startScrollScreenshot}
          initialPluginId={activePluginId}
          onPluginIdConsumed={() => setActivePluginId(null)}
          pendingAttachment={pendingDrop}
          onPendingAttachmentConsumed={() => setPendingDrop(null)}
          pendingMessage={pendingClipboardMsg}
          onPendingMessageConsumed={() => setPendingClipboardMsg(null)}
          assistantFocusRequest={assistantFocusRequest}
        />
      )}
      {screenshotImage && (
        <ScreenCapture
          imageDataUrl={screenshotImage}
          mode={captureMode}
          busy={scrollCaptureBusy}
          progress={scrollCaptureProgress}
          onCapture={handleScreenshotCapture}
          onScrollCapture={handleScrollCapture}
          onCancel={handleScreenshotCancel}
        />
      )}
    </div>
  )
}

export default App
