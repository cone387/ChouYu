import { globalShortcut, BrowserWindow } from 'electron'

export function registerHotkey(mainWindow: BrowserWindow): void {
  globalShortcut.register('Alt+Space', () => {
    // Focus the window so the textarea can receive keyboard input
    // On Windows, transparent windows need explicit focus
    if (!mainWindow.isFocused()) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver')
      mainWindow.focus()
      mainWindow.setAlwaysOnTop(true, 'floating')
    }
    mainWindow.webContents.send('toggle-panel')
  })
}
