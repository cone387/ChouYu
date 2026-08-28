import { app, BrowserWindow, screen, shell, globalShortcut } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'
import { setupTray } from './tray'
import { registerHotkey } from './hotkey'
import { initDatabase, getConfig, flushDatabase } from './database'
import { initAutoUpdater } from './updater'
import { pluginRegistry } from './plugins/registry'
import { registerPluginTools } from './tools/plugin-tools'
import { closeMemory, getMemoryProvider, initializeMemory } from './memory/service'
import { setClipboardWatcherEnabled, stopClipboardWatcher } from './clipboard'

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
      setTimeout(() => app.quit(), 150)
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
  initializeMemory()
  if (isSmokeTest) {
    getMemoryProvider().createActive({
      type: 'preference',
      content: '用户偏好简短回答',
      importance: 0.8,
      confidence: 1,
      sensitivity: 'normal',
      sourceSessionId: 'smoke-session'
    })
    if (getMemoryProvider().search('回答风格', 3).length === 0) throw new Error('Memory smoke test failed')
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
