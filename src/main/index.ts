import { app, BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'
import { setupTray } from './tray'
import { registerHotkey } from './hotkey'
import { initDatabase } from './database'
import { initAutoUpdater } from './updater'
import { pluginRegistry } from './plugins/registry'

let mainWindow: BrowserWindow | null = null

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
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

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
    mainWindow!.show()
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

  // Register plugins and IPC channels synchronously (before window loads renderer)
  pluginRegistry.register()

  // Create window
  createWindow()

  // Register IPC handlers immediately after window creation
  registerIpcHandlers(mainWindow!)

  // Async plugin init (network requests etc) - IPC handlers already available
  await pluginRegistry.initializePlugins()
  setupTray(mainWindow!)
  registerHotkey(mainWindow!)

  if (app.isPackaged) {
    // Delay update check to avoid competing with startup I/O
    setTimeout(() => initAutoUpdater(mainWindow!), 5000)
  }
})

app.on('window-all-closed', () => {
  app.quit()
})

export { mainWindow }
