import { ipcMain, BrowserWindow } from 'electron'
import {
  getConfig,
  saveConfig,
  getMessages,
  saveMessages,
  clearMessages,
  getState,
  setState
} from './database'

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  ipcMain.on('set-ignore-mouse-events', (_event, ignore: boolean) => {
    if (mainWindow) {
      if (ignore) {
        mainWindow.setIgnoreMouseEvents(true, { forward: true })
      } else {
        mainWindow.setIgnoreMouseEvents(false)
      }
    }
  })

  ipcMain.on('renderer-log', (_event, msg: string) => {
    console.log('[Renderer]', msg)
  })

  ipcMain.on('toggle-panel', () => {
    mainWindow.webContents.send('toggle-panel')
  })

  ipcMain.handle('db:get-config', () => getConfig())
  ipcMain.handle('db:save-config', (_event, patch) => saveConfig(patch))
  ipcMain.handle('db:get-messages', () => getMessages())
  ipcMain.handle('db:save-messages', (_event, messages) => saveMessages(messages))
  ipcMain.handle('db:clear-messages', () => clearMessages())
  ipcMain.handle('db:get-state', (_event, key) => getState(key))
  ipcMain.handle('db:set-state', (_event, key, value) => setState(key, value))
}
