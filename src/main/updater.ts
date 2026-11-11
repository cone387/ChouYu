import { autoUpdater } from 'electron-updater'
import { app, powerMonitor, type BrowserWindow } from 'electron'
import { UpdateService } from './update-service'

let service: UpdateService | undefined
let window: BrowserWindow | undefined
let installing = false
const INSTALL_FAILED_FLAG = '--update-install-failed'

export function initAutoUpdater(mainWindow: BrowserWindow): UpdateService {
  window = mainWindow
  if (service) return service
  service = new UpdateService(autoUpdater, state => {
    if (installing && state.phase === 'error' && state.errorStage === 'install') {
      // Services and storage are already closed. Restore a usable app with an inline retry notice.
      installing = false
      app.relaunch({ args: [...process.argv.slice(1).filter(arg => arg !== INSTALL_FAILED_FLAG), INSTALL_FAILED_FLAG] })
      app.quit()
      return
    }
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('update:state', state)
    }
  }, () => app.quit(), app.isPackaged && process.env.CHOUYU_SMOKE_TEST !== '1', process.argv.includes(INSTALL_FAILED_FLAG))
  const resume = () => service?.resume()
  powerMonitor.on('resume', resume)
  app.once('will-quit', () => { powerMonitor.removeListener('resume', resume); service?.dispose() })
  service.start()
  return service
}

export function cancelPendingUpdateInstall(): void { service?.cancelInstall() }
export function hasPendingUpdateInstall(): boolean { return service?.hasPendingInstall() ?? false }
export function installPendingUpdate(): void {
  if (!service?.hasPendingInstall()) return
  installing = true
  service.installAfterCleanup()
}
