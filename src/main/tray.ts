import { Tray, Menu, BrowserWindow, app, nativeImage } from 'electron'
import { PET_ICON_PNG_BASE64 } from '../shared/pet-icon'

let tray: Tray | null = null

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
    {
      label: '打开聊天',
      click: openChatPanel
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

  tray.setToolTip('ChouYu')
  tray.setContextMenu(contextMenu)
  tray.on('click', openChatPanel)
  tray.on('double-click', openChatPanel)
}
