import { app, BrowserWindow, screen, shell, globalShortcut } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'
import { setupTray } from './tray'
import { registerHotkey } from './hotkey'
import { initDatabase, getConfig, flushDatabase } from './database'
import { initAutoUpdater } from './updater'
import { pluginRegistry } from './plugins/registry'
import { registerPluginTools } from './tools/plugin-tools'
import { closeMemory, createMemoryTopic, getMemoryInsights, getMemoryProvider, importMemories, initializeMemory, listMemoryClusters, previewMemoryImport, proposeMemoryCandidate, runMemoryMaintenance, searchMemories, splitMemoryCluster } from './memory/service'
import { setClipboardWatcherEnabled, stopClipboardWatcher } from './clipboard'
import { registerBuiltInCapabilities } from './capabilities/builtins'
import { capabilityRegistry } from './capabilities/registry'

let mainWindow: BrowserWindow | null = null
const isSmokeTest = process.env['CHOUYU_SMOKE_TEST'] === '1'
const smokeUserDataDir = process.env['CHOUYU_SMOKE_USER_DATA']

if (isSmokeTest) {
  if (smokeUserDataDir) app.setPath('userData', smokeUserDataDir)
  app.disableHardwareAcceleration()
}

function createWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize

  mainWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const openExternal = (target: string): void => {
    try {
      const url = new URL(target)
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        void shell.openExternal(url.toString())
      }
    } catch {
      // Ignore malformed or unsupported URLs.
    }
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) {
      event.preventDefault()
      openExternal(url)
    }
  })

  if (isSmokeTest) {
    mainWindow.webContents.once('did-finish-load', () => {
      console.log(`CHOUYU_SMOKE_READY version=${app.getVersion()} packaged=${app.isPackaged}`)
      setTimeout(() => app.quit(), 300)
    })
    mainWindow.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
      console.error(`CHOUYU_SMOKE_FAILED code=${errorCode} message=${errorDescription}`)
      app.exit(1)
    })
    mainWindow.webContents.once('render-process-gone', (_event, details) => {
      console.error(`CHOUYU_SMOKE_FAILED renderer=${details.reason}`)
      app.exit(1)
    })
  }

  mainWindow.setIgnoreMouseEvents(true, { forward: true })

  // Intercept keyboard shortcuts
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    // Prevent Ctrl+W from closing the window (only hide the panel)
    if (input.control && !input.shift && input.key.toLowerCase() === 'w') {
      _event.preventDefault()
      mainWindow!.webContents.send('hide-panel')
      return
    }
    // Dev tools toggle (dev mode only)
    if (!app.isPackaged && input.control && input.shift && input.key.toLowerCase() === 'i') {
      _event.preventDefault()
      if (mainWindow!.webContents.isDevToolsOpened()) {
        mainWindow!.webContents.closeDevTools()
      } else {
        mainWindow!.webContents.openDevTools({ mode: 'detach' })
      }
    }
  })

  // Show window once renderer is ready to avoid blank frame
  mainWindow.once('ready-to-show', () => {
    if (!isSmokeTest) mainWindow!.show()
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  // Init database first (needed by plugins and IPC handlers)
  initDatabase()
  registerBuiltInCapabilities()
  initializeMemory()
  if (isSmokeTest) {
    const capabilityCatalog = capabilityRegistry.list(getConfig())
    const activeMemoryEngines = capabilityCatalog.filter((item) => item.kind === 'memory-engine' && item.active)
    if (activeMemoryEngines.length !== 1 || !activeMemoryEngines.some((item) => item.id === 'chouyu-sqlite')) throw new Error('Capability registry smoke test failed')
    const memoryProvider = getMemoryProvider()
    memoryProvider.createActive({
      type: 'preference',
      content: '用户偏好简短回答',
      importance: 0.8,
      confidence: 1,
      sensitivity: 'normal',
      sourceSessionId: 'smoke-session'
    })
    if (memoryProvider.search('回答风格', 3).length === 0) throw new Error('Memory smoke test failed')

    const identityMemory = memoryProvider.createActive({
      type: 'person', content: '我的名字是 Smoke User', importance: 0.9, confidence: 1, sensitivity: 'normal'
    })
    const identityResults = await searchMemories('我是谁', 3)
    if (!identityResults.some((memory) => memory.id === identityMemory.id)) throw new Error('Cross-session identity retrieval smoke test failed')
    memoryProvider.delete(identityMemory.id)
    const invalidIdentity = memoryProvider.createActive({
      type: 'person', content: '我的名字是什么', importance: 0.8, confidence: 0.9, sensitivity: 'normal'
    })
    if (!runMemoryMaintenance().archivedIds.includes(invalidIdentity.id)) throw new Error('Invalid identity cleanup smoke test failed')

    const oldMemory = memoryProvider.createActive({
      type: 'fact',
      content: '我的显示器是 4K',
      importance: 0.8,
      confidence: 1,
      sensitivity: 'normal'
    })
    const candidate = proposeMemoryCandidate({
      type: 'fact',
      content: '我的显示器是 5K',
      importance: 0.8,
      confidence: 1,
      sensitivity: 'normal'
    })
    if (!candidate?.conflicts?.length) throw new Error('Memory conflict smoke test failed')
    let approvalBlocked = false
    try {
      memoryProvider.approve(candidate.id)
    } catch {
      approvalBlocked = true
    }
    if (!approvalBlocked) throw new Error('Conflicting memory was approved without a decision')
    const replacement = memoryProvider.resolveConflict(candidate.id, 'replace')
    if (!replacement || replacement.status !== 'active') throw new Error('Memory replacement smoke test failed')
    if (memoryProvider.list({ status: 'archived' }).every((memory) => memory.id !== oldMemory.id)) throw new Error('Replaced memory was not archived')
    if (memoryProvider.listRevisions(oldMemory.id)[0]?.reason !== 'replace') throw new Error('Replacement revision was not saved')
    memoryProvider.update(replacement.id, { content: '我的显示器是 6K' })
    const revision = memoryProvider.listRevisions(replacement.id)[0]
    if (!revision || memoryProvider.restoreRevision(replacement.id, revision.id).content !== '我的显示器是 5K') throw new Error('Memory revision restore smoke test failed')

    const helpful = memoryProvider.recordFeedback(replacement.id, 'smoke-answer', 'helpful')
    const duplicateHelpful = memoryProvider.recordFeedback(replacement.id, 'smoke-answer', 'helpful')
    const correctedFeedback = memoryProvider.recordFeedback(replacement.id, 'smoke-answer', 'unhelpful')
    if (helpful.helpfulCount !== 1 || duplicateHelpful.helpfulCount !== 1 || correctedFeedback.helpfulCount !== 0 || correctedFeedback.unhelpfulCount !== 1) throw new Error('Memory feedback smoke test failed')

    const expiring = memoryProvider.createActive({
      type: 'fact', content: '临时 smoke 记忆', importance: 0.4, confidence: 1, sensitivity: 'normal', expiresAt: Date.now() - 1
    })
    if (!memoryProvider.expireDue().includes(expiring.id) || memoryProvider.list({ status: 'archived' }).find((memory) => memory.id === expiring.id)?.archivedReason !== 'expired') throw new Error('Memory expiration smoke test failed')

    const cleanup = memoryProvider.createActive({
      type: 'fact', content: '低价值 smoke 记忆', importance: 0.1, confidence: 1, sensitivity: 'normal'
    })
    if (!memoryProvider.cleanupCandidates().some((memory) => memory.id === cleanup.id)) throw new Error('Memory cleanup preview smoke test failed')
    if (!memoryProvider.archiveMany([cleanup.id], 'cleanup').includes(cleanup.id)) throw new Error('Memory bulk archive smoke test failed')

    for (let index = 0; index < 49; index += 1) {
      memoryProvider.createActive({ type: 'fact', content: `容量 smoke 记忆 ${index}`, importance: 0.5, confidence: 1, sensitivity: 'normal' })
    }
    if (memoryProvider.enforceCapacity(50).length !== 1 || memoryProvider.stats().active !== 50) throw new Error('Memory capacity smoke test failed')
    const smokeClusters = listMemoryClusters()
    const compressedMemories = await searchMemories('容量 smoke', 6)
    if (!smokeClusters.some((cluster) => cluster.memoryIds.length > 2)) throw new Error('Memory clustering smoke test failed')
    if (!compressedMemories.some((memory) => (memory.compressedCount || 0) > 2 && (memory.sourceMemoryIds?.length || 0) > 2)) throw new Error('Memory compression smoke test failed')

    const manualLeft = memoryProvider.createActive({ type: 'project', content: '人工主题来源 Alpha', importance: 0.7, confidence: 1, sensitivity: 'normal' })
    const manualRight = memoryProvider.createActive({ type: 'project', content: '人工主题来源 Beta', importance: 0.7, confidence: 1, sensitivity: 'normal' })
    const manualTopic = createMemoryTopic('Smoke 人工主题', [manualLeft.id, manualRight.id])
    if (!manualTopic.manual || manualTopic.memoryIds.length !== 2) throw new Error('Manual memory topic smoke test failed')
    splitMemoryCluster(manualTopic.id, manualTopic.memoryIds, true)
    if (listMemoryClusters().some((cluster) => cluster.id === manualTopic.id)) throw new Error('Memory topic split smoke test failed')

    const importPreview = previewMemoryImport({ memories: [
      { type: 'fact', content: '导入 smoke 事实', importance: 0.7, confidence: 1 },
      { type: 'fact', content: '我的显示器是 5K', importance: 0.7, confidence: 1 },
      { type: 'fact', content: '我的显示器是 8K', importance: 0.7, confidence: 1 }
    ] })
    if (!importPreview.items.some((item) => item.status === 'new') || !importPreview.items.some((item) => item.status === 'duplicate') || !importPreview.items.some((item) => item.status === 'conflict')) throw new Error('Memory import preview smoke test failed')
    const importResult = importMemories(importPreview.items.map((item) => ({ item, action: item.status === 'new' ? 'add' : item.status === 'conflict' ? 'replace' : 'skip' })))
    if (importResult.added !== 1 || importResult.replaced !== 1 || importResult.skipped !== 1) throw new Error('Memory import commit smoke test failed')
    const insights = getMemoryInsights()
    if (insights.byType.length !== 5 || insights.createdByWeek.length !== 8) throw new Error('Memory insights smoke test failed')
  }

  // Register plugins and IPC channels synchronously (before window loads renderer)
  pluginRegistry.register()
  registerPluginTools()

  // Create window
  createWindow()

  // Register IPC handlers immediately after window creation
  registerIpcHandlers(mainWindow!)

  // Async plugin init (network requests etc) - IPC handlers already available
  await pluginRegistry.initializePlugins()
  if (!isSmokeTest) {
    setupTray(mainWindow!)
    registerHotkey(mainWindow!)
    setClipboardWatcherEnabled(mainWindow!, getConfig().clipboardWatch)
  }

  if (app.isPackaged && !isSmokeTest) {
    // Sync auto-start setting with system
    const config = getConfig()
    app.setLoginItemSettings({
      openAtLogin: config.autoStart ?? false,
      openAsHidden: true
    })

    // Delay update check to avoid competing with startup I/O
    setTimeout(() => initAutoUpdater(mainWindow!), 5000)
  }
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', () => {
  stopClipboardWatcher()
  flushDatabase()
  closeMemory()
  globalShortcut.unregisterAll()
})

export { mainWindow }
