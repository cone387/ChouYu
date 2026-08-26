import { ipcMain, BrowserWindow, desktopCapturer, screen, dialog, app } from 'electron'
import fs from 'fs'
import path from 'path'
import { sanitizeConfigPatch } from '../shared/config'
import { reloadPluginHotkeys, updateMainHotkey } from './hotkey'
import { setClipboardWatcherEnabled } from './clipboard'
import { initAutoUpdater } from './updater'
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
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      const { width, height } = display.size
      const scale = display.scaleFactor || 1
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) }
      })
      if (shouldHide) mainWindow.show()
      const source = sources.find((candidate) => candidate.display_id === String(display.id)) || sources[0]
      if (source) {
        return source.thumbnail.toDataURL()
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
    const stat = await fs.promises.stat(filePath)
    const maxBytes = imageExts.includes(ext) ? 10 * 1024 * 1024 : 2 * 1024 * 1024
    if (stat.size > maxBytes) {
      await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        message: '文件过大',
        detail: imageExts.includes(ext) ? '图片不能超过 10 MB。' : '文本文件不能超过 2 MB。'
      })
      return null
    }
    if (imageExts.includes(ext)) {
      const data = await fs.promises.readFile(filePath)
      const base64 = data.toString('base64')
      const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/bmp'
      return { type: 'image', data: `data:${mime};base64,${base64}`, name: path.basename(filePath) }
    }
    const text = await fs.promises.readFile(filePath, 'utf-8')
    return { type: 'text', data: text, name: path.basename(filePath) }
  })

  ipcMain.handle('fetch-models', async () => {
    const config = getConfig()
    if (!config.baseUrl || !config.apiKey) return []
    try {
      const baseUrl = new URL(config.baseUrl)
      if (!['http:', 'https:'].includes(baseUrl.protocol)) return []
      const url = config.baseUrl.replace(/\/+$/, '') + '/models'
      const headers = config.provider === 'claude'
        ? { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' }
        : { 'Authorization': `Bearer ${config.apiKey}` }
      const resp = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10_000)
      })
      if (!resp.ok) return []
      const json = (await resp.json()) as { data?: { id?: string }[] }
      const models = json.data || []
      return models.map((m) => m.id).filter(Boolean)
    } catch {
      return []
    }
  })

  ipcMain.handle('get-app-version', () => app.getVersion())

  ipcMain.handle('quit-app', () => {
    app.quit()
  })

  ipcMain.handle('set-auto-start', (_event, enabled: boolean) => {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true
    })
  })

  ipcMain.handle('check-for-updates', () => {
    if (!app.isPackaged) {
      // Dev mode: updater won't work, notify renderer directly
      mainWindow.webContents.send('update:error', '开发模式下无法检查更新')
      return null
    }
    initAutoUpdater(mainWindow)
    return null
  })

  ipcMain.handle('db:get-config', () => getConfig())
  ipcMain.handle('db:save-config', (_event, rawPatch) => {
    const patch = sanitizeConfigPatch(rawPatch)
    if (patch.hotkey && !updateMainHotkey(patch.hotkey)) {
      throw new Error(`快捷键“${patch.hotkey}”无效或已被其他程序占用`)
    }
    saveConfig(patch)
    const updated = getConfig()
    if (typeof patch.autoStart === 'boolean') {
      app.setLoginItemSettings({ openAtLogin: patch.autoStart, openAsHidden: true })
    }
    if (typeof patch.clipboardWatch === 'boolean') {
      setClipboardWatcherEnabled(mainWindow, patch.clipboardWatch)
    }
    mainWindow.webContents.send('config:changed', updated)
    return updated
  })
  ipcMain.handle('db:get-messages', () => getMessages())
  ipcMain.handle('db:save-messages', (_event, messages) => saveMessages(messages))
  ipcMain.handle('db:clear-messages', () => clearMessages())
  ipcMain.handle('db:get-state', (_event, key) => {
    if (typeof key !== 'string' || key.length > 256) return null
    return getState(key)
  })
  ipcMain.handle('db:set-state', (_event, key, value) => {
    if (typeof key !== 'string' || !key || key.length > 256) throw new Error('Invalid state key')
    if (typeof value !== 'string' || value.length > 1_000_000) throw new Error('Invalid state value')
    const pluginHotkeyMatch = key.match(/^plugin:([^:]+):hotkey$/)
    const previousValue = pluginHotkeyMatch ? getState(key) ?? '' : ''
    setState(key, value)
    if (pluginHotkeyMatch) {
      const failedPluginIds = reloadPluginHotkeys(mainWindow)
      if (failedPluginIds.includes(pluginHotkeyMatch[1])) {
        setState(key, previousValue)
        reloadPluginHotkeys(mainWindow)
        throw new Error(`快捷键“${value}”无效或已被其他程序占用`)
      }
    }
  })
}
