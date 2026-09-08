import { Tray, Menu, BrowserWindow, MenuItem, app, nativeImage, ipcMain } from 'electron'
import { PET_ICON_PNG_BASE64 } from '../shared/pet-icon'
import { openJournalWindow, toggleJournalPause, getJournalStatus } from './journal'

let tray: Tray | null = null
let petVisibilityItem: MenuItem | null = null

export function setTrayPetVisible(visible: boolean): void {
  if (petVisibilityItem) petVisibilityItem.checked = visible
}

export function setupTray(mainWindow: BrowserWindow): void {
  const icon = nativeImage.createFromBuffer(Buffer.from(PET_ICON_PNG_BASE64, 'base64')).resize({ width: 16, height: 16, quality: 'best' })
  if (icon.isEmpty()) throw new Error('Tray icon failed to render')
  tray = new Tray(icon)

  const openChatPanel = () => {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    mainWindow.moveTop()
    mainWindow.webContents.send('open-chat-panel')
  }

  const contextMenu = Menu.buildFromTemplate([
    { label: '工作日志', click: openJournalWindow },
    { id: 'journal-state', label: '活动记录：未开启', enabled: false },
    { id: 'journal-pause', label: '暂停活动记录', click: toggleJournalPause, enabled: false },
    {
      label: '打开聊天',
      click: openChatPanel
    },
    {
      label: '显示桌面宠物',
      type: 'checkbox',
      checked: true,
      click: (item) => {
        mainWindow.webContents.send('set-pet-visible', item.checked)
      }
    },
    { type: 'separator' },
    {
      label: '设置',
      click: () => {
        mainWindow.show()
        mainWindow.setIgnoreMouseEvents(false)
        mainWindow.webContents.send('open-settings')
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.quit()
      }
    }
  ])
  petVisibilityItem = contextMenu.items.find((item) => item.type === 'checkbox') || null
  ipcMain.removeAllListeners('pet-visibility-changed')
  ipcMain.on('pet-visibility-changed', (_event, visible: boolean) => {
    if (typeof visible === 'boolean') setTrayPetVisible(visible)
  })

  tray.setToolTip('ChouYu')
  tray.setContextMenu(contextMenu)
  const updateJournalStatus = () => {
    const status = getJournalStatus()
    if (!status || !tray || tray.isDestroyed()) return
    const text = status.state === 'error' ? '记录异常' : !status.config.enabled ? '未开启' : status.config.paused ? '已暂停' : status.state === 'locked' ? '锁屏暂停' : status.state === 'idle' ? '空闲暂停' : status.state === 'excluded' ? '当前应用不记录' : status.state === 'starting' ? '启动中' : '正在记录'
    const scope = !status.config.enabled ? '' : status.captureError ? ' · 画面异常' : status.config.captureEnabled ? ' · 活动＋画面＋OCR' : ' · 仅标题'
    contextMenu.getMenuItemById('journal-state')!.label = `活动记录：${text}${scope}`
    const pause = contextMenu.getMenuItemById('journal-pause')!
    pause.enabled = status.config.enabled
    pause.label = status.config.paused ? '继续活动记录' : '暂停活动记录'
    tray.setToolTip(`ChouYu · 活动记录${text}${scope}`)
  }
  updateJournalStatus()
  const journalTimer = setInterval(updateJournalStatus, 3000)
  app.once('will-quit', () => clearInterval(journalTimer))
  tray.on('click', openChatPanel)
  tray.on('double-click', openChatPanel)
}
