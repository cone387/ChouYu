import { autoUpdater, UpdateInfo } from 'electron-updater'
import { BrowserWindow, dialog } from 'electron'

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

let initialized = false

function formatUpdateError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '')
  const message = raw.toLowerCase()
  if (message.includes('401') || message.includes('403') || message.includes('bad credentials') || message.includes('token')) {
    return '更新检查失败：发布源需要有效权限，或当前版本尚未发布。'
  }
  if (message.includes('404') || message.includes('latest.yml') || message.includes('not found')) {
    return '暂无可用的更新信息，请先发布对应版本后再检查。'
  }
  if (message.includes('network') || message.includes('enotfound') || message.includes('timeout') || message.includes('econn')) {
    return '更新检查失败：无法连接更新服务器，请检查网络后重试。'
  }
  return '更新检查失败，请稍后重试。'
}

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
    console.warn('[Updater] Update check failed:', err)
    mainWindow.webContents.send('update:error', formatUpdateError(err))
  })

  void autoUpdater.checkForUpdates()
}
