import { Tray, Menu, BrowserWindow, MenuItem, app, nativeImage, ipcMain } from 'electron'
import { PET_ICON_PNG_BASE64, TRANSPARENT_ICON_PNG_BASE64 } from '../shared/pet-icon'
import { TrayFlasher } from './tray-flasher'
import { openJournalWorkspace, toggleJournalPause, getJournalStatus } from './journal'

let tray: Tray | null = null
let petVisibilityItem: MenuItem | null = null
let trayUnreadCount = 0

export function setTrayPetVisible(visible: boolean): void {
  if (petVisibilityItem) petVisibilityItem.checked = visible
}

export function setupTray(mainWindow: BrowserWindow): void {
  const icon = nativeImage.createFromBuffer(Buffer.from(PET_ICON_PNG_BASE64, 'base64')).resize({ width: 16, height: 16, quality: 'best' })
  if (icon.isEmpty()) throw new Error('Tray icon failed to render')
  tray = new Tray(icon)

  const blankIcon = nativeImage.createFromBuffer(Buffer.from(TRANSPARENT_ICON_PNG_BASE64, 'base64')).resize({ width: 16, height: 16, quality: 'best' })
  const flasher = new TrayFlasher({
    showNormal: () => { if (tray && !tray.isDestroyed()) tray.setImage(icon) },
    showBlank: () => { if (tray && !tray.isDestroyed()) tray.setImage(blankIcon) }
  })

  const openChatPanel = () => {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    mainWindow.moveTop()
    mainWindow.webContents.send('open-chat-panel')
  }

  const openMessages = () => {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    mainWindow.moveTop()
    mainWindow.setIgnoreMouseEvents(false)
    mainWindow.webContents.send('open-messages-center')
  }

  const contextMenu = Menu.buildFromTemplate([
    { label: '工作日志', click: openJournalWorkspace },
    { id: 'journal-state', label: '活动记录：未开启', enabled: false },
    { id: 'journal-pause', label: '暂停活动记录', click: toggleJournalPause, enabled: false },
    {
      label: '打开聊天',
      click: openChatPanel
    },
    {
      label: '助手消息',
      click: openMessages
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
    const unreadSuffix = trayUnreadCount > 0 ? ` · ${trayUnreadCount} 条新消息` : ''
    tray.setToolTip(`ChouYu · 活动记录${text}${scope}${unreadSuffix}`)
  }
  const setTrayUnread = (count: number) => {
    const next = Math.max(0, Math.floor(count) || 0)
    trayUnreadCount = next
    if (!tray || tray.isDestroyed()) return
    if (next > 0) flasher.start()
    else flasher.stop()
    updateJournalStatus()
  }
  ipcMain.removeAllListeners('proactive-unread-changed')
  ipcMain.on('proactive-unread-changed', (_event, count: number) => {
    if (typeof count === 'number') setTrayUnread(count)
  })
  updateJournalStatus()
  const journalTimer = setInterval(updateJournalStatus, 3000)
  app.once('will-quit', () => {
    clearInterval(journalTimer)
    flasher.dispose()
  })
  const onTrayClick = () => {
    if (trayUnreadCount > 0) openMessages()
    else openChatPanel()
  }
  tray.on('click', onTrayClick)
  tray.on('double-click', onTrayClick)
}
