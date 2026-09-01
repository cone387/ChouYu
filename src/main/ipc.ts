import { ipcMain, BrowserWindow, desktopCapturer, screen, dialog, app } from 'electron'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { sanitizeConfigPatch } from '../shared/config'
import type { AIChatMessage, AIModelListResult, AIStreamEvent, AIStreamRequest, AIStreamResult } from '../shared/ai'
import { formatSessionMarkdown } from '../shared/sessions'
import {
  type MemoryCandidateInput,
  type MemoryConflictAction,
  type MemoryFeedbackValue,
  type MemoryImportDecision,
  type MemoryListOptions,
  type MemoryType,
  containsSecret,
  extractMemoryCandidates,
  shouldAutoWriteMemory
} from '../shared/memory'
import {
  type CaptureSourceInfo,
  filterCaptureSources,
  getCaptureSourceKind,
  isValidCaptureSourceId
} from '../shared/capture'
import { reloadPluginHotkeys, updateMainHotkey } from './hotkey'
import { capabilityRegistry } from './capabilities/registry'
import { setClipboardWatcherEnabled } from './clipboard'
import { initAutoUpdater } from './updater'
import { diagnoseProvider, fetchProviderModels, streamAIChat } from './ai'
import { executeRegisteredTool, getRegisteredTool, getToolDefinitions } from './tools/registry'
import {
  getMemoryProvider,
  createMemory,
  createMemoryTopic,
  getMemoryInsights,
  importMemories,
  indexMemory,
  listMemoryClusters,
  previewMemoryImport,
  previewMemorySyncPull,
  proposeMemoryCandidate,
  reactivateMemory,
  rebuildEmbeddings,
  runMemoryMaintenance,
  resolveMemoryConflict,
  restoreMemoryRevision,
  searchMemories,
  splitMemoryCluster,
  pushMemoriesToSync,
  testMemorySync,
  testEmbedding
} from './memory/service'
import {
  type AIToolCall,
  type ToolCatalogItem,
  type ToolApprovalRequest,
  type ToolExecutionEvent,
  parseToolArguments,
  shouldConfirmTool
} from '../shared/tools'
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
const pendingToolApprovals = new Map<string, {
  senderId: number
  resolve: (approved: boolean) => void
  timeout: ReturnType<typeof setTimeout>
}>()

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

function isToolEnabled(name: string): boolean {
  return getState(`tool:${name}:enabled`) !== 'false'
}

function sendToolEvent(
  sender: Electron.WebContents,
  event: ToolExecutionEvent
): void {
  if (!sender.isDestroyed()) sender.send('ai:tool-event', event)
}

function requestToolApproval(
  sender: Electron.WebContents,
  requestId: string,
  call: AIToolCall,
  signal: AbortSignal
): Promise<boolean> {
  const definition = getRegisteredTool(call.name)
  if (!definition || sender.isDestroyed()) return Promise.resolve(false)
  const approvalId = randomUUID()
  const approvalRequest: ToolApprovalRequest = {
    requestId,
    approvalId,
    callId: call.id,
    name: definition.name,
    displayName: definition.displayName,
    description: definition.description,
    risk: definition.risk,
    arguments: parseToolArguments(call.arguments)
  }
  return new Promise((resolve) => {
    let settled = false
    const finish = (approved: boolean) => {
      if (settled) return
      settled = true
      const pending = pendingToolApprovals.get(approvalId)
      if (pending) clearTimeout(pending.timeout)
      pendingToolApprovals.delete(approvalId)
      signal.removeEventListener('abort', abort)
      resolve(approved)
    }
    const abort = () => finish(false)
    const timeout = setTimeout(() => finish(false), 60_000)
    pendingToolApprovals.set(approvalId, { senderId: sender.id, resolve: finish, timeout })
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    else sender.send('ai:tool-approval-request', approvalRequest)
  })
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

  ipcMain.handle('diagnose-provider', async () => diagnoseProvider(getConfig()))

  ipcMain.handle('tools:list', (): ToolCatalogItem[] =>
    getToolDefinitions().map((tool) => ({ ...tool, enabled: isToolEnabled(tool.name) })))

  ipcMain.handle('tools:set-enabled', (_event, name: string, enabled: boolean): ToolCatalogItem[] => {
    if (typeof name !== 'string' || !/^[a-z][a-z0-9_]{1,63}$/.test(name) || typeof enabled !== 'boolean') {
      throw new Error('Invalid tool setting')
    }
    if (!getRegisteredTool(name)) throw new Error('工具不存在。')
    setState(`tool:${name}:enabled`, enabled ? 'true' : 'false')
    return getToolDefinitions().map((tool) => ({ ...tool, enabled: isToolEnabled(tool.name) }))
  })

  ipcMain.handle('capabilities:list', () => capabilityRegistry.list(getConfig()))

  ipcMain.handle('memory:list', (_event, rawOptions?: MemoryListOptions) => {
    runMemoryMaintenance()
    const options: MemoryListOptions = rawOptions && typeof rawOptions === 'object' ? {
      query: typeof rawOptions.query === 'string' ? rawOptions.query.slice(0, 500) : undefined,
      status: ['pending', 'active', 'archived', 'all'].includes(String(rawOptions.status)) ? rawOptions.status : 'all',
      type: ['fact', 'preference', 'person', 'project', 'workflow', 'all'].includes(String(rawOptions.type)) ? rawOptions.type : 'all',
      limit: typeof rawOptions.limit === 'number' ? Math.min(1000, Math.max(1, rawOptions.limit)) : 500
    } : { status: 'all', limit: 500 }
    return getMemoryProvider().list(options)
  })

  ipcMain.handle('memory:stats', () => {
    runMemoryMaintenance()
    return getMemoryProvider().stats()
  })

  ipcMain.handle('memory:search', (_event, query: string, limit?: number) => {
    if (typeof query !== 'string' || !query.trim()) return []
    return searchMemories(query.slice(0, 4000), typeof limit === 'number' ? limit : 6)
  })

  ipcMain.handle('memory:propose', (_event, text: string, sessionId?: string, messageId?: string) => {
    if (typeof text !== 'string' || text.length > 4000) return []
    const { memoryEnabled, memoryWriteMode, memoryAutoWriteConfidence } = getConfig()
    if (!memoryEnabled || memoryWriteMode === 'off') return []
    const candidates = extractMemoryCandidates(text, {
      sessionId: typeof sessionId === 'string' ? sessionId.slice(0, 128) : undefined,
      messageId: typeof messageId === 'string' ? messageId.slice(0, 128) : undefined
    })
    return candidates.map((candidate) => memoryWriteMode === 'auto' && shouldAutoWriteMemory(candidate, memoryAutoWriteConfidence)
      ? createMemory(candidate)
      : proposeMemoryCandidate(candidate)).filter(Boolean)
  })

  ipcMain.handle('memory:create', (_event, rawCandidate: MemoryCandidateInput) => {
    if (!rawCandidate || typeof rawCandidate !== 'object' || typeof rawCandidate.content !== 'string') throw new Error('Invalid memory')
    if (containsSecret(rawCandidate.content)) throw new Error('检测到密码、Token 或密钥，已阻止保存。')
    const candidate: MemoryCandidateInput = {
      type: ['fact', 'preference', 'person', 'project', 'workflow'].includes(rawCandidate.type) ? rawCandidate.type : 'fact',
      content: rawCandidate.content.slice(0, 500),
      importance: Number.isFinite(rawCandidate.importance) ? rawCandidate.importance : 0.6,
      confidence: Number.isFinite(rawCandidate.confidence) ? rawCandidate.confidence : 1,
      sensitivity: rawCandidate.sensitivity === 'sensitive' ? 'sensitive' : 'normal',
      sourceSessionId: typeof rawCandidate.sourceSessionId === 'string' ? rawCandidate.sourceSessionId.slice(0, 128) : undefined,
      sourceMessageId: typeof rawCandidate.sourceMessageId === 'string' ? rawCandidate.sourceMessageId.slice(0, 128) : undefined
    }
    return createMemory(candidate)
  })

  ipcMain.handle('memory:approve', (_event, id: string) => {
    if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid memory id')
    const memory = getMemoryProvider().approve(id)
    void indexMemory(memory).catch((error) => console.warn('[Memory] Failed to index approved memory:', error))
    runMemoryMaintenance()
    return memory
  })

  ipcMain.handle('memory:reject', (_event, id: string) => {
    if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid memory id')
    getMemoryProvider().reject(id)
  })

  ipcMain.handle('memory:conflicts', (_event, candidateId?: string) => {
    if (candidateId !== undefined && (typeof candidateId !== 'string' || !candidateId || candidateId.length > 128)) throw new Error('Invalid memory id')
    return getMemoryProvider().listConflicts(candidateId)
  })

  ipcMain.handle('memory:resolve-conflict', (_event, candidateId: string, action: MemoryConflictAction) => {
    if (typeof candidateId !== 'string' || !candidateId || candidateId.length > 128) throw new Error('Invalid memory id')
    if (!['replace', 'keep', 'reject'].includes(action)) throw new Error('Invalid conflict action')
    return resolveMemoryConflict(candidateId, action)
  })

  ipcMain.handle('memory:history', (_event, memoryId: string) => {
    if (typeof memoryId !== 'string' || !memoryId || memoryId.length > 128) throw new Error('Invalid memory id')
    return getMemoryProvider().listRevisions(memoryId)
  })

  ipcMain.handle('memory:restore-revision', (_event, memoryId: string, revisionId: string) => {
    if (typeof memoryId !== 'string' || !memoryId || memoryId.length > 128) throw new Error('Invalid memory id')
    if (typeof revisionId !== 'string' || !revisionId || revisionId.length > 128) throw new Error('Invalid revision id')
    return restoreMemoryRevision(memoryId, revisionId)
  })

  ipcMain.handle('memory:maintenance', () => runMemoryMaintenance())

  ipcMain.handle('memory:cleanup-preview', (_event, limit?: number) =>
    getMemoryProvider().cleanupCandidates(typeof limit === 'number' ? Math.min(100, Math.max(1, limit)) : 30))

  ipcMain.handle('memory:clusters', () => listMemoryClusters())

  ipcMain.handle('memory:create-topic', (_event, label: string, rawIds: unknown) => {
    if (typeof label !== 'string' || !label.trim() || label.length > 60) throw new Error('Invalid topic label')
    if (!Array.isArray(rawIds) || rawIds.length < 2 || rawIds.length > 100) throw new Error('Invalid topic memories')
    const ids = rawIds.map((id) => {
      if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Invalid memory id')
      return id
    })
    return createMemoryTopic(label, ids)
  })

  ipcMain.handle('memory:split-cluster', (_event, clusterId: string, rawIds: unknown, manual: boolean) => {
    if (typeof clusterId !== 'string' || !clusterId || clusterId.length > 128 || typeof manual !== 'boolean') throw new Error('Invalid memory cluster')
    if (!Array.isArray(rawIds) || rawIds.length < 2 || rawIds.length > 100) throw new Error('Invalid cluster memories')
    const ids = rawIds.map((id) => {
      if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Invalid memory id')
      return id
    })
    return splitMemoryCluster(clusterId, ids, manual)
  })

  ipcMain.handle('memory:insights', () => getMemoryInsights())

  ipcMain.handle('memory:import-preview', async () => {
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: '导入 ChouYu 记忆',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (selection.canceled || !selection.filePaths[0]) return { canceled: true, items: [], invalid: 0, blockedSecrets: 0 }
    const filePath = selection.filePaths[0]
    const stat = await fs.promises.stat(filePath)
    if (stat.size > 5 * 1024 * 1024) throw new Error('记忆导入文件不能超过 5 MB。')
    let parsed: unknown
    try {
      parsed = JSON.parse(await fs.promises.readFile(filePath, 'utf8'))
    } catch {
      throw new Error('无法解析 JSON 文件，请确认文件格式正确。')
    }
    return { canceled: false, fileName: path.basename(filePath), ...previewMemoryImport(parsed) }
  })

  ipcMain.handle('memory:import-commit', (_event, decisions: MemoryImportDecision[]) => {
    if (!Array.isArray(decisions) || decisions.length > 2000) throw new Error('Invalid memory import')
    return importMemories(decisions)
  })

  ipcMain.handle('memory:sync-test', () => testMemorySync())
  ipcMain.handle('memory:sync-pull-preview', () => previewMemorySyncPull())
  ipcMain.handle('memory:sync-push', () => pushMemoriesToSync())

  ipcMain.handle('memory:archive-many', (_event, rawIds: unknown) => {
    if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > 500) throw new Error('Invalid memory ids')
    const ids = rawIds.map((id) => {
      if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Invalid memory id')
      return id
    })
    return getMemoryProvider().archiveMany(ids, 'cleanup')
  })

  ipcMain.handle('memory:reactivate', (_event, memoryId: string) => {
    if (typeof memoryId !== 'string' || !memoryId || memoryId.length > 128) throw new Error('Invalid memory id')
    return reactivateMemory(memoryId)
  })

  ipcMain.handle('memory:feedback', (_event, memoryId: string, contextId: string, value: MemoryFeedbackValue) => {
    if (typeof memoryId !== 'string' || !memoryId || memoryId.length > 128) throw new Error('Invalid memory id')
    if (typeof contextId !== 'string' || !contextId || contextId.length > 128) throw new Error('Invalid feedback context')
    if (!['helpful', 'unhelpful'].includes(value)) throw new Error('Invalid memory feedback')
    return getMemoryProvider().recordFeedback(memoryId, contextId, value)
  })

  ipcMain.handle('memory:update', (_event, id: string, patch: { content?: string; type?: string; importance?: number; expiresAt?: number | null }) => {
    if (typeof id !== 'string' || id.length > 128 || !patch || typeof patch !== 'object') throw new Error('Invalid memory update')
    if (typeof patch.content === 'string' && containsSecret(patch.content)) throw new Error('检测到密码、Token 或密钥，已阻止保存。')
    const memory = getMemoryProvider().update(id, {
      content: typeof patch.content === 'string' ? patch.content.slice(0, 500) : undefined,
      type: ['fact', 'preference', 'person', 'project', 'workflow'].includes(String(patch.type)) ? patch.type as MemoryType : undefined,
      importance: typeof patch.importance === 'number' ? patch.importance : undefined,
      expiresAt: patch.expiresAt === null || typeof patch.expiresAt === 'number' ? patch.expiresAt : undefined
    })
    void indexMemory(memory).catch((error) => console.warn('[Memory] Failed to reindex memory:', error))
    return memory
  })

  ipcMain.handle('memory:delete', (_event, id: string) => {
    if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid memory id')
    getMemoryProvider().delete(id)
  })

  ipcMain.handle('memory:clear', () => getMemoryProvider().clear())

  ipcMain.handle('memory:export', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出 ChouYu 记忆',
      defaultPath: `ChouYu-memory-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    await fs.promises.writeFile(result.filePath, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), memories: getMemoryProvider().exportAll() }, null, 2), 'utf8')
    return { ok: true, canceled: false, filePath: result.filePath }
  })

  ipcMain.handle('memory:test-embedding', () => testEmbedding())
  ipcMain.handle('memory:rebuild-embeddings', () => rebuildEmbeddings())

  ipcMain.handle('get-capture-sources', async (): Promise<CaptureSourceInfo[]> => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true
      })
      return filterCaptureSources(sources, app.getName())
        .slice(0, 40)
        .map((source) => ({
          id: source.id,
          name: source.name.slice(0, 200),
          kind: getCaptureSourceKind(source.id),
          thumbnail: source.thumbnail.toDataURL(),
          appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.resize({ width: 24, height: 24 }).toDataURL() : undefined
        }))
    } catch (error) {
      console.error('Failed to enumerate capture sources:', error)
      return []
    }
  })

  ipcMain.handle('capture-source', async (_event, sourceId: unknown, hideWindow?: boolean) => {
    if (!isValidCaptureSourceId(sourceId)) throw new Error('Invalid capture source id')
    const shouldHide = hideWindow !== false
    if (shouldHide) mainWindow.hide()
    await new Promise((resolve) => setTimeout(resolve, 160))
    try {
      const kind = getCaptureSourceKind(sourceId)
      const sources = await desktopCapturer.getSources({
        types: [kind],
        thumbnailSize: { width: 2560, height: 1600 }
      })
      const source = sources.find((candidate) => candidate.id === sourceId)
      if (!source || source.thumbnail.isEmpty()) throw new Error('捕获源已关闭或不可用。')
      return source.thumbnail.toDataURL()
    } finally {
      if (shouldHide && !mainWindow.isDestroyed()) mainWindow.show()
    }
  })

  ipcMain.handle('ai:stream', async (event, rawRequest): Promise<AIStreamResult> => {
    const request = parseAIStreamRequest(rawRequest)
    if (!request) return { ok: false, error: 'AI 请求参数无效。' }

    const requestKey = getAIRequestKey(event.sender.id, request.requestId)
    activeAIRequests.get(requestKey)?.abort()
    const controller = new AbortController()
    const config = getConfig()
    activeAIRequests.set(requestKey, controller)
    const abortWhenDestroyed = () => controller.abort()
    event.sender.once('destroyed', abortWhenDestroyed)

    try {
      await streamAIChat(
        request.messages,
        request.systemPrompt,
        config,
        (chunk, done) => {
          if (event.sender.isDestroyed()) return
          const streamEvent: AIStreamEvent = { requestId: request.requestId, chunk, done }
          event.sender.send('ai:stream-event', streamEvent)
        },
        controller.signal,
        config.aiToolsEnabled ? {
          definitions: getToolDefinitions().filter((tool) => isToolEnabled(tool.name)),
          execute: async (call) => {
            const definition = getRegisteredTool(call.name)
            if (!definition) return `工具不存在：${call.name}`
            if (!isToolEnabled(call.name)) return `工具已被用户禁用：${call.name}`
            const arguments_ = parseToolArguments(call.arguments)
            const needsApproval = shouldConfirmTool(definition, config.toolPermissionMode)
            sendToolEvent(event.sender, {
              requestId: request.requestId,
              callId: call.id,
              name: definition.name,
              displayName: definition.displayName,
              risk: definition.risk,
              status: needsApproval ? 'requested' : 'running',
              summary: needsApproval ? '等待用户确认' : '正在执行'
            })
            if (needsApproval) {
              const approved = await requestToolApproval(event.sender, request.requestId, call, controller.signal)
              if (!approved) {
                sendToolEvent(event.sender, {
                  requestId: request.requestId,
                  callId: call.id,
                  name: definition.name,
                  displayName: definition.displayName,
                  risk: definition.risk,
                  status: 'denied',
                  summary: '用户拒绝了此操作'
                })
                return '用户拒绝了此工具调用。'
              }
              sendToolEvent(event.sender, {
                requestId: request.requestId,
                callId: call.id,
                name: definition.name,
                displayName: definition.displayName,
                risk: definition.risk,
                status: 'running',
                summary: '已授权，正在执行'
              })
            }
            try {
              const result = await executeRegisteredTool(call.name, arguments_, mainWindow)
              sendToolEvent(event.sender, {
                requestId: request.requestId,
                callId: call.id,
                name: definition.name,
                displayName: definition.displayName,
                risk: definition.risk,
                status: 'completed',
                summary: result.summary.slice(0, 500)
              })
              return result.content.slice(0, 50_000)
            } catch (error) {
              const message = getErrorMessage(error)
              sendToolEvent(event.sender, {
                requestId: request.requestId,
                callId: call.id,
                name: definition.name,
                displayName: definition.displayName,
                risk: definition.risk,
                status: 'error',
                summary: message.slice(0, 500)
              })
              return `工具执行失败：${message}`
            }
          }
        } : undefined
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

  ipcMain.on('ai:resolve-tool-request', (event, approvalId: string, approved: boolean) => {
    if (typeof approvalId !== 'string' || typeof approved !== 'boolean') return
    const pending = pendingToolApprovals.get(approvalId)
    if (!pending || pending.senderId !== event.sender.id) return
    pending.resolve(approved)
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
    if (patch.memoryMaxItems !== undefined || patch.memoryDefaultTtlDays !== undefined) runMemoryMaintenance()
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
