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

    ipc.handle('update:get-state', () => initAutoUpdater(mainWindow).snapshot())
    ipc.handle('check-for-updates', async () => {
      const updater = initAutoUpdater(mainWindow)
      await updater.check()
      return updater.snapshot()
    })
    ipc.handle('update:download', async () => {
      const updater = initAutoUpdater(mainWindow)
      await updater.download()
      return updater.snapshot()
    })
    ipc.handle('update:install', () => {
      const updater = initAutoUpdater(mainWindow)
      updater.requestInstall()
      return updater.snapshot()
    })
  })
}
