import { ipcMain, BrowserWindow, desktopCapturer, screen, dialog, app } from 'electron'
import fs from 'fs'
import path from 'path'
import { sanitizeConfigPatch } from '../shared/config'
import type { AIChatMessage, AIModelListResult, AIStreamEvent, AIStreamRequest, AIStreamResult } from '../shared/ai'
import { formatSessionMarkdown } from '../shared/sessions'
import { reloadPluginHotkeys, updateMainHotkey } from './hotkey'
import { setClipboardWatcherEnabled } from './clipboard'
import { initAutoUpdater } from './updater'
import { fetchProviderModels, streamAIChat } from './ai'
import {
  getConfig,
  saveConfig,
  getMessages,
  saveMessages,
  clearMessages,
  getSessionWorkspace,
  getSession,
  createChatSession,
  selectChatSession,
  renameChatSession,
  deleteChatSession,
  saveSessionMessages,
  getState,
  setState
} from './database'

const activeAIRequests = new Map<string, AbortController>()

function getAIRequestKey(senderId: number, requestId: string): string {
  return `${senderId}:${requestId}`
}

function parseAIStreamRequest(value: unknown): AIStreamRequest | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.requestId)) return null
  if (typeof input.systemPrompt !== 'string' || input.systemPrompt.length > 50_000) return null
  if (!Array.isArray(input.messages) || input.messages.length > 30) return null

  const messages: AIChatMessage[] = []
  for (const item of input.messages) {
    if (!item || typeof item !== 'object') return null
    const message = item as Record<string, unknown>
    if (!['user', 'assistant', 'system'].includes(String(message.role))) return null
    if (typeof message.content !== 'string' || message.content.length > 200_000) return null
    if (message.imageUrl !== undefined && (typeof message.imageUrl !== 'string' || message.imageUrl.length > 15_000_000)) return null
    messages.push({
      role: message.role as AIChatMessage['role'],
      content: message.content,
      imageUrl: message.imageUrl as string | undefined
    })
  }

  return { requestId: input.requestId, systemPrompt: input.systemPrompt, messages }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'AI 请求失败，请检查 Provider 配置和网络后重试。'
}

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

  ipcMain.on('set-window-always-on-top', (_event, alwaysOnTop: boolean) => {
    if (typeof alwaysOnTop === 'boolean' && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(alwaysOnTop, 'floating')
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

  ipcMain.handle('fetch-models', async (): Promise<AIModelListResult> => {
    const config = getConfig()
    const result = await fetchProviderModels(config)
    if (result.ok && result.baseUrlAdjusted) {
      saveConfig({ baseUrl: result.baseUrl })
      mainWindow.webContents.send('config:changed', getConfig())
    }
    return result
  })

  ipcMain.handle('ai:stream', async (event, rawRequest): Promise<AIStreamResult> => {
    const request = parseAIStreamRequest(rawRequest)
    if (!request) return { ok: false, error: 'AI 请求参数无效。' }

    const requestKey = getAIRequestKey(event.sender.id, request.requestId)
    activeAIRequests.get(requestKey)?.abort()
    const controller = new AbortController()
    activeAIRequests.set(requestKey, controller)
    const abortWhenDestroyed = () => controller.abort()
    event.sender.once('destroyed', abortWhenDestroyed)

    try {
      await streamAIChat(
        request.messages,
        request.systemPrompt,
        getConfig(),
        (chunk, done) => {
          if (event.sender.isDestroyed()) return
          const streamEvent: AIStreamEvent = { requestId: request.requestId, chunk, done }
          event.sender.send('ai:stream-event', streamEvent)
        },
        controller.signal
      )
      return { ok: true }
    } catch (error) {
      if (controller.signal.aborted) return { ok: false, error: 'AI 请求已取消。' }
      return { ok: false, error: getErrorMessage(error) }
    } finally {
      event.sender.removeListener('destroyed', abortWhenDestroyed)
      if (activeAIRequests.get(requestKey) === controller) activeAIRequests.delete(requestKey)
    }
  })

  ipcMain.on('ai:cancel', (event, requestId: string) => {
    if (typeof requestId !== 'string') return
    activeAIRequests.get(getAIRequestKey(event.sender.id, requestId))?.abort()
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
  ipcMain.handle('db:get-session-workspace', () => getSessionWorkspace())
  ipcMain.handle('db:create-session', (_event, title?: string) =>
    createChatSession(typeof title === 'string' ? title.slice(0, 80) : undefined))
  ipcMain.handle('db:select-session', (_event, id: string) => {
    if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Invalid session id')
    return selectChatSession(id)
  })
  ipcMain.handle('db:rename-session', (_event, id: string, title: string) => {
    if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Invalid session id')
    if (typeof title !== 'string') throw new Error('Invalid session title')
    return renameChatSession(id, title.slice(0, 80))
  })
  ipcMain.handle('db:delete-session', (_event, id: string) => {
    if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Invalid session id')
    return deleteChatSession(id)
  })
  ipcMain.handle('db:save-session-messages', (_event, id: string, messages) => {
    if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Invalid session id')
    if (!Array.isArray(messages)) throw new Error('Invalid session messages')
    return saveSessionMessages(id, messages)
  })
  ipcMain.handle('db:export-session', async (_event, id: string) => {
    if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Invalid session id')
    const session = getSession(id)
    if (!session) throw new Error('会话不存在或已被删除。')
    const safeTitle = session.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 60) || 'ChouYu 对话'
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出对话',
      defaultPath: `${safeTitle}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    await fs.promises.writeFile(result.filePath, formatSessionMarkdown(session), 'utf-8')
    return { ok: true, canceled: false, filePath: result.filePath }
  })
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
