import { Tray, Menu, BrowserWindow, MenuItem, app, nativeImage, ipcMain } from 'electron'
import { PET_ICON_PNG_BASE64 } from '../shared/pet-icon'

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
  tray.on('click', openChatPanel)
  tray.on('double-click', openChatPanel)
}
