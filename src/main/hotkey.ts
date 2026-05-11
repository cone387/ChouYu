import { globalShortcut, BrowserWindow } from 'electron'

export function registerHotkey(mainWindow: BrowserWindow): void {
  globalShortcut.register('Alt+Space', () => {
    mainWindow.webContents.send('toggle-panel')
  })
}
