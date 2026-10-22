import { BrowserWindow, app, powerMonitor } from 'electron'
import { setWindowMouseIgnored } from '../mouse-events'
import { initAutoUpdater } from '../updater'
import { ipcMain } from 'electron'
import { registerDomain } from './registration'

export function registerDesktopHandlers(mainWindow: BrowserWindow) {
  return registerDomain(ipcMain, ipc => {  
    ipc.handle('system-idle-seconds', () => {
      const idle = powerMonitor.getSystemIdleTime()
      return powerMonitor.getSystemIdleState(300) === 'locked' ? Math.max(300, idle) : idle
    })

    ipc.on('set-ignore-mouse-events', (_event, ignore: boolean) => {
      if (typeof ignore === 'boolean') setWindowMouseIgnored(ignore)
    })

    ipc.on('set-window-always-on-top', (_event, alwaysOnTop: boolean) => {
      if (typeof alwaysOnTop === 'boolean' && !mainWindow.isDestroyed()) {
        mainWindow.setAlwaysOnTop(alwaysOnTop, 'floating')
      }
    })

    ipc.on('renderer-log', (_event, msg: string) => {
      console.log('[Renderer]', msg)
    })

    ipc.on('toggle-panel', () => {
      mainWindow.webContents.send('toggle-panel')
    })

    ipc.handle('get-app-version', () => app.getVersion())

    ipc.handle('quit-app', () => {
      app.quit()
    })

    ipc.handle('set-auto-start', (_event, enabled: boolean) => {
      app.setLoginItemSettings({
        openAtLogin: enabled
      })
    })

    ipc.handle('check-for-updates', () => {
      if (!app.isPackaged) {
        // Dev mode: updater won't work, notify renderer directly
        mainWindow.webContents.send('update:error', '开发模式下无法检查更新')
        return null
      }
      initAutoUpdater(mainWindow)
      return null
    })
  })
}
