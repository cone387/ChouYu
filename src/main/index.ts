import { app, BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'
import { setupTray } from './tray'
import { registerHotkey } from './hotkey'

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
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.setIgnoreMouseEvents(true, { forward: true })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  registerIpcHandlers(mainWindow!)
  setupTray(mainWindow!)
  registerHotkey(mainWindow!)
})

app.on('window-all-closed', () => {
  app.quit()
})

export { mainWindow }
