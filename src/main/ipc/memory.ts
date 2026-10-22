import { BrowserWindow, dialog } from 'electron'
import fs from 'fs'
import path from 'path'
import { DEFAULT_CHARACTER_ID } from '../../shared/characters'
import { type MemoryCandidateInput, type MemoryConflictAction, type MemoryFeedbackValue, type MemoryImportDecision, type MemoryListOptions, type MemoryType, containsSecret, shouldAutoWriteMemory } from '../../shared/memory'
import { getMemoryProvider, createMemory, createMemoryTopic, getIdentityProfile, getMemoryInsights, importMemories, indexMemory, listMemoryClusters, previewMemoryImport, proposeMemoryCandidate, rememberRawMemory, reactivateMemory, rebuildEmbeddings, runMemoryMaintenance, resolveMemoryConflict, restoreMemoryRevision, searchMemories, splitMemoryCluster, testMemoryEngine, testEmbedding } from '../memory/service'
import { extractMemoriesWithLLM } from '../memory/llm-extractor'
import { getConfig, getSession } from '../database'
import { ipcMain } from 'electron'
import { registerDomain } from './registration'

export function registerMemoryHandlers(mainWindow: BrowserWindow) {
  return registerDomain(ipcMain, ipc => {  
  
    const readMemoryList = (rawOptions?: MemoryListOptions, paged = false) => {
      runMemoryMaintenance()
      const options: MemoryListOptions = rawOptions && typeof rawOptions === 'object' ? {
        query: typeof rawOptions.query === 'string' ? rawOptions.query.slice(0, 500) : undefined,
        status: ['pending', 'active', 'archived', 'all'].includes(String(rawOptions.status)) ? rawOptions.status : 'all',
        type: ['fact', 'preference', 'person', 'project', 'workflow', 'all'].includes(String(rawOptions.type)) ? rawOptions.type : 'all',
        limit: Number.isFinite(rawOptions.limit) ? Math.min(1000, Math.max(1, Math.floor(rawOptions.limit!))) : 500,
        offset: Number.isFinite(rawOptions.offset) ? Math.max(0, Math.floor(rawOptions.offset!)) : 0,
        sortBy: rawOptions.sortBy === 'importance' || rawOptions.sortBy === 'usage' ? rawOptions.sortBy : 'updated'
      } : { status: 'all', limit: 500 }
      return paged ? getMemoryProvider().listPage(options) : getMemoryProvider().list(options)
    }
  
    ipc.handle('memory:list', (_event, options) => readMemoryList(options))
  
    ipc.handle('memory:list-page', (_event, options) => readMemoryList(options, true))

    ipc.handle('memory:refresh-remote-list', () => {
      const provider = getMemoryProvider()
      if (!provider.refreshRemoteList) throw new Error('当前记忆引擎不支持远端列表刷新。')
      return provider.refreshRemoteList()
    })

    ipc.handle('memory:stats', () => {
      runMemoryMaintenance()
      return getMemoryProvider().stats()
    })

    ipc.handle('memory:identity', () => getIdentityProfile())

    ipc.handle('memory:search', (_event, query: string, limit?: number) => {
      if (typeof query !== 'string' || !query.trim()) return []
      return searchMemories(query.slice(0, 4000), typeof limit === 'number' ? limit : 6)
    })

    ipc.handle('memory:propose', async (_event, text: string, sessionId?: string, messageId?: string) => {
      if (typeof text !== 'string' || text.length > 4000) return []
      // Legacy memories belong to the default companion. Other contacts keep private
      // conversation history and an explicit memory library, never a shared extraction.
      if (sessionId && getSession(sessionId)?.characterId !== DEFAULT_CHARACTER_ID) return []
      const { memoryEnabled, memoryWriteMode, memoryAutoWriteConfidence } = getConfig()
      if (!memoryEnabled || memoryWriteMode === 'off') return []
      const currentConfig = getConfig()
      const remoteMemoryEngine = currentConfig.memoryEngineProvider === 'mem0-self-hosted-engine' || currentConfig.memoryEngineProvider === 'mem0-platform-engine'
      if (remoteMemoryEngine) {
        try {
          return await rememberRawMemory(text, {
            sessionId: typeof sessionId === 'string' ? sessionId.slice(0, 128) : undefined,
            messageId: typeof messageId === 'string' ? messageId.slice(0, 128) : undefined
          })
        } catch (error) {
          console.warn('[Memory] Mem0 primary extraction failed:', error)
          throw error instanceof Error ? error : new Error('Mem0 记忆写入失败，请检查连接配置。')
        }
      }
      let candidates: Awaited<ReturnType<typeof extractMemoriesWithLLM>>
      try {
        candidates = await extractMemoriesWithLLM(text, getConfig())
      } catch (error) {
        console.warn('[Memory] LLM extraction failed; no memory written:', error)
        return []
      }
      return (await Promise.all(candidates.map((candidate) => memoryWriteMode === 'auto' && shouldAutoWriteMemory(candidate, memoryAutoWriteConfidence)
        ? createMemory({ ...candidate, sourceSessionId: typeof sessionId === 'string' ? sessionId.slice(0, 128) : undefined, sourceMessageId: typeof messageId === 'string' ? messageId.slice(0, 128) : undefined })
        : proposeMemoryCandidate({ ...candidate, sourceSessionId: typeof sessionId === 'string' ? sessionId.slice(0, 128) : undefined, sourceMessageId: typeof messageId === 'string' ? messageId.slice(0, 128) : undefined })))).filter(Boolean)
    })

    ipc.handle('memory:create', (_event, rawCandidate: MemoryCandidateInput) => {
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

    ipc.handle('memory:approve', async (_event, id: string) => {
      if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid memory id')
      const provider = getMemoryProvider()
      const memory = provider.approveConfirmed ? await provider.approveConfirmed(id) : provider.approve(id)
      void indexMemory(memory).catch((error) => console.warn('[Memory] Failed to index approved memory:', error))
      runMemoryMaintenance()
      return memory
    })

    ipc.handle('memory:reject', (_event, id: string) => {
      if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid memory id')
      const provider = getMemoryProvider()
      return provider.rejectConfirmed ? provider.rejectConfirmed(id) : provider.reject(id)
    })

    ipc.handle('memory:conflicts', (_event, candidateId?: string) => {
      if (candidateId !== undefined && (typeof candidateId !== 'string' || !candidateId || candidateId.length > 128)) throw new Error('Invalid memory id')
      return getMemoryProvider().listConflicts(candidateId)
    })

    ipc.handle('memory:resolve-conflict', (_event, candidateId: string, action: MemoryConflictAction) => {
      if (typeof candidateId !== 'string' || !candidateId || candidateId.length > 128) throw new Error('Invalid memory id')
      if (!['replace', 'keep', 'reject'].includes(action)) throw new Error('Invalid conflict action')
      return resolveMemoryConflict(candidateId, action)
    })

    ipc.handle('memory:history', (_event, memoryId: string) => {
      if (typeof memoryId !== 'string' || !memoryId || memoryId.length > 128) throw new Error('Invalid memory id')
      return getMemoryProvider().listRevisions(memoryId)
    })

    ipc.handle('memory:restore-revision', (_event, memoryId: string, revisionId: string) => {
      if (typeof memoryId !== 'string' || !memoryId || memoryId.length > 128) throw new Error('Invalid memory id')
      if (typeof revisionId !== 'string' || !revisionId || revisionId.length > 128) throw new Error('Invalid revision id')
      return restoreMemoryRevision(memoryId, revisionId)
    })

    ipc.handle('memory:maintenance', () => runMemoryMaintenance())

    ipc.handle('memory:cleanup-preview', (_event, limit?: number) =>
      getMemoryProvider().cleanupCandidates(typeof limit === 'number' ? Math.min(100, Math.max(1, limit)) : 30))

    ipc.handle('memory:clusters', () => listMemoryClusters())

    ipc.handle('memory:create-topic', (_event, label: string, rawIds: unknown) => {
      if (typeof label !== 'string' || !label.trim() || label.length > 60) throw new Error('Invalid topic label')
      if (!Array.isArray(rawIds) || rawIds.length < 2 || rawIds.length > 100) throw new Error('Invalid topic memories')
      const ids = rawIds.map((id) => {
        if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Invalid memory id')
        return id
      })
      return createMemoryTopic(label, ids)
    })

    ipc.handle('memory:split-cluster', (_event, clusterId: string, rawIds: unknown, manual: boolean) => {
      if (typeof clusterId !== 'string' || !clusterId || clusterId.length > 128 || typeof manual !== 'boolean') throw new Error('Invalid memory cluster')
      if (!Array.isArray(rawIds) || rawIds.length < 2 || rawIds.length > 100) throw new Error('Invalid cluster memories')
      const ids = rawIds.map((id) => {
        if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Invalid memory id')
        return id
      })
      return splitMemoryCluster(clusterId, ids, manual)
    })

    ipc.handle('memory:insights', () => getMemoryInsights())

    ipc.handle('memory:import-preview', async () => {
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

    ipc.handle('memory:import-commit', (_event, decisions: MemoryImportDecision[]) => {
      if (!Array.isArray(decisions) || decisions.length > 2000) throw new Error('Invalid memory import')
      return importMemories(decisions)
    })

    ipc.handle('memory:engine-test', () => testMemoryEngine())

    ipc.handle('memory:archive-many', (_event, rawIds: unknown) => {
      if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > 500) throw new Error('Invalid memory ids')
      const ids = rawIds.map((id) => {
        if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Invalid memory id')
        return id
      })
      const provider = getMemoryProvider()
      return provider.archiveManyConfirmed ? provider.archiveManyConfirmed(ids, 'cleanup') : provider.archiveMany(ids, 'cleanup')
    })

    ipc.handle('memory:reactivate', (_event, memoryId: string) => {
      if (typeof memoryId !== 'string' || !memoryId || memoryId.length > 128) throw new Error('Invalid memory id')
      return reactivateMemory(memoryId)
    })

    ipc.handle('memory:feedback', (_event, memoryId: string, contextId: string, value: MemoryFeedbackValue) => {
      if (typeof memoryId !== 'string' || !memoryId || memoryId.length > 128) throw new Error('Invalid memory id')
      if (typeof contextId !== 'string' || !contextId || contextId.length > 128) throw new Error('Invalid feedback context')
      if (!['helpful', 'unhelpful'].includes(value)) throw new Error('Invalid memory feedback')
      return getMemoryProvider().recordFeedback(memoryId, contextId, value)
    })

    ipc.handle('memory:update', async (_event, id: string, patch: { content?: string; type?: string; importance?: number; expiresAt?: number | null }) => {
      if (typeof id !== 'string' || id.length > 128 || !patch || typeof patch !== 'object') throw new Error('Invalid memory update')
      if (typeof patch.content === 'string' && containsSecret(patch.content)) throw new Error('检测到密码、Token 或密钥，已阻止保存。')
      const provider = getMemoryProvider()
      const update = provider.updateConfirmed?.bind(provider) || provider.update.bind(provider)
      const memory = await update(id, {
        content: typeof patch.content === 'string' ? patch.content.slice(0, 500) : undefined,
        type: ['fact', 'preference', 'person', 'project', 'workflow'].includes(String(patch.type)) ? patch.type as MemoryType : undefined,
        importance: typeof patch.importance === 'number' ? patch.importance : undefined,
        expiresAt: patch.expiresAt === null || typeof patch.expiresAt === 'number' ? patch.expiresAt : undefined
      })
      void indexMemory(memory).catch((error) => console.warn('[Memory] Failed to reindex memory:', error))
      return memory
    })

    ipc.handle('memory:delete', async (_event, id: string) => {
      if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid memory id')
      const provider = getMemoryProvider()
      if (provider.deleteConfirmed) await provider.deleteConfirmed(id)
      else provider.delete(id)
    })

    ipc.handle('memory:clear', () => {
      const provider = getMemoryProvider()
      return provider.clearConfirmed ? provider.clearConfirmed() : provider.clear()
    })

    ipc.handle('memory:export', async () => {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '导出 ChouYu 记忆',
        defaultPath: `ChouYu-memory-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) return { ok: false, canceled: true }
      await fs.promises.writeFile(result.filePath, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), memories: getMemoryProvider().exportAll() }, null, 2), 'utf8')
      return { ok: true, canceled: false, filePath: result.filePath }
    })

    ipc.handle('memory:test-embedding', () => testEmbedding())
  
    ipc.handle('memory:rebuild-embeddings', () => rebuildEmbeddings())
  })
}
