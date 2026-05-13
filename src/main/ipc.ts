import { ipcMain, BrowserWindow, desktopCapturer, screen, dialog } from 'electron'
import fs from 'fs'
import path from 'path'
import {
  getConfig,
  saveConfig,
  getMessages,
  saveMessages,
  clearMessages,
  getState,
  setState
} from './database'

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  ipcMain.on('set-ignore-mouse-events', (_event, ignore: boolean) => {
    if (mainWindow) {
      if (ignore) {
        mainWindow.setIgnoreMouseEvents(true, { forward: true })
      } else {
        mainWindow.setIgnoreMouseEvents(false)
      }
    }
  })

  ipcMain.on('renderer-log', (_event, msg: string) => {
    console.log('[Renderer]', msg)
  })

  ipcMain.on('toggle-panel', () => {
    mainWindow.webContents.send('toggle-panel')
  })

  ipcMain.handle('take-screenshot', async (_event, hideWindow?: boolean) => {
    const shouldHide = hideWindow !== false
    if (shouldHide) mainWindow.hide()
    await new Promise((r) => setTimeout(r, 200))
    try {
      const display = screen.getPrimaryDisplay()
      const { width, height } = display.size
      const scale = display.scaleFactor || 1
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) }
      })
      if (shouldHide) mainWindow.show()
      if (sources.length > 0) {
        return sources[0].thumbnail.toDataURL()
      }
    } catch {
      if (shouldHide) mainWindow.show()
    }
    return null
  })

  ipcMain.handle('open-file-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] },
        { name: '文本', extensions: ['txt', 'md', 'json', 'csv', 'log'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const ext = path.extname(filePath).toLowerCase()
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']
    if (imageExts.includes(ext)) {
      const data = fs.readFileSync(filePath)
      const base64 = data.toString('base64')
      const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/bmp'
      return { type: 'image', data: `data:${mime};base64,${base64}`, name: path.basename(filePath) }
    }
    const text = fs.readFileSync(filePath, 'utf-8')
    return { type: 'text', data: text, name: path.basename(filePath) }
  })

  ipcMain.handle('fetch-models', async () => {
    const config = getConfig()
    if (!config.baseUrl || !config.apiKey) return []
    try {
      const url = config.baseUrl.replace(/\/$/, '') + '/models'
      const resp = await fetch(url, {
        headers: { 'Authorization': `Bearer ${config.apiKey}` }
      })
      if (!resp.ok) return []
      const json = (await resp.json()) as { data?: { id?: string }[] }
      const models = json.data || []
      return models.map((m) => m.id).filter(Boolean)
    } catch {
      return []
    }
  })

  ipcMain.handle('db:get-config', () => getConfig())
  ipcMain.handle('db:save-config', (_event, patch) => saveConfig(patch))
  ipcMain.handle('db:get-messages', () => getMessages())
  ipcMain.handle('db:save-messages', (_event, messages) => saveMessages(messages))
  ipcMain.handle('db:clear-messages', () => clearMessages())
  ipcMain.handle('db:get-state', (_event, key) => getState(key))
  ipcMain.handle('db:set-state', (_event, key, value) => setState(key, value))
}
