import { autoUpdater, UpdateInfo } from 'electron-updater'
import { BrowserWindow, dialog } from 'electron'

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

let initialized = false

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  if (initialized) {
    void autoUpdater.checkForUpdates()
    return
  }
  initialized = true

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    mainWindow.webContents.send('update:available', {
      version: info.version,
      releaseNotes: info.releaseNotes
    })

    dialog
      .showMessageBox({
        type: 'info',
        title: '发现新版本',
        message: `ChouYu ${info.version} 已发布，是否立即下载？`,
        buttons: ['下载', '稍后'],
        defaultId: 0,
        cancelId: 1
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.downloadUpdate()
          mainWindow.webContents.send('update:downloading')
        }
      })
  })

  autoUpdater.on('update-not-available', () => {
    mainWindow.webContents.send('update:not-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    mainWindow.webContents.send('update:progress', {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    mainWindow.webContents.send('update:downloaded', { version: info.version })

    dialog
      .showMessageBox({
        type: 'info',
        title: '更新已就绪',
        message: `ChouYu ${info.version} 已下载完成。重启应用以完成更新。`,
        buttons: ['立即重启', '退出时安装'],
        defaultId: 0,
        cancelId: 1
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall(false, true)
        }
      })
  })

  autoUpdater.on('error', (err) => {
    mainWindow.webContents.send('update:error', err.message)
  })

  void autoUpdater.checkForUpdates()
}
