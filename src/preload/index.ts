import { contextBridge, ipcRenderer } from 'electron'
import type { AppConfig } from '../shared/config'
import type { AIModelListResult, AIStreamEvent, AIStreamRequest, AIStreamResult } from '../shared/ai'
import type { CaptureSourceInfo } from '../shared/capture'
import type { ToolApprovalRequest, ToolCatalogItem, ToolExecutionEvent } from '../shared/tools'
import type { EmbeddingRebuildResult, EmbeddingStatus, MemoryCandidateInput, MemoryCleanupSuggestion, MemoryCluster, MemoryConflict, MemoryConflictAction, MemoryFeedbackResult, MemoryFeedbackValue, MemoryImportDecision, MemoryImportPreview, MemoryImportResult, MemoryInsights, MemoryListOptions, MemoryMaintenanceResult, MemoryRecord, MemoryRevision, MemorySearchResult, MemoryStats, MemorySyncPullPreview, MemorySyncPushResult, MemorySyncStatus } from '../shared/memory'

const api = {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  setAutoStart: (enabled: boolean) => ipcRenderer.invoke('set-auto-start', enabled),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  setIgnoreMouseEvents: (ignore: boolean) => {
    ipcRenderer.send('set-ignore-mouse-events', ignore)
  },
  setWindowAlwaysOnTop: (alwaysOnTop: boolean) => {
    ipcRenderer.send('set-window-always-on-top', alwaysOnTop)
  },
  log: (msg: string) => {
    ipcRenderer.send('renderer-log', msg)
  },
  takeScreenshot: (hideWindow?: boolean) => ipcRenderer.invoke('take-screenshot', hideWindow),
  getCaptureSources: () => ipcRenderer.invoke('get-capture-sources') as Promise<CaptureSourceInfo[]>,
  captureSource: (sourceId: string, hideWindow?: boolean) => ipcRenderer.invoke('capture-source', sourceId, hideWindow) as Promise<string>,
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  fetchModels: () => ipcRenderer.invoke('fetch-models') as Promise<AIModelListResult>,
  ai: {
    startStream: (request: AIStreamRequest) =>
      ipcRenderer.invoke('ai:stream', request) as Promise<AIStreamResult>,
    cancelStream: (requestId: string) => {
      ipcRenderer.send('ai:cancel', requestId)
    },
    resolveToolRequest: (approvalId: string, approved: boolean) => {
      ipcRenderer.send('ai:resolve-tool-request', approvalId, approved)
    },
    onToolApprovalRequest: (callback: (request: ToolApprovalRequest) => void) => {
      const handler = (_event: unknown, request: ToolApprovalRequest) => callback(request)
      ipcRenderer.on('ai:tool-approval-request', handler)
      return () => { ipcRenderer.removeListener('ai:tool-approval-request', handler) }
    },
    onToolEvent: (callback: (event: ToolExecutionEvent) => void) => {
      const handler = (_event: unknown, toolEvent: ToolExecutionEvent) => callback(toolEvent)
      ipcRenderer.on('ai:tool-event', handler)
      return () => { ipcRenderer.removeListener('ai:tool-event', handler) }
    },
    onStreamEvent: (callback: (event: AIStreamEvent) => void) => {
      const handler = (_event: unknown, streamEvent: AIStreamEvent) => callback(streamEvent)
      ipcRenderer.on('ai:stream-event', handler)
      return () => { ipcRenderer.removeListener('ai:stream-event', handler) }
    }
  },
  tools: {
    list: () => ipcRenderer.invoke('tools:list') as Promise<ToolCatalogItem[]>,
    setEnabled: (name: string, enabled: boolean) => ipcRenderer.invoke('tools:set-enabled', name, enabled) as Promise<ToolCatalogItem[]>
  },
  memory: {
    list: (options?: MemoryListOptions) => ipcRenderer.invoke('memory:list', options) as Promise<MemoryRecord[]>,
    stats: () => ipcRenderer.invoke('memory:stats') as Promise<MemoryStats>,
    search: (query: string, limit?: number) => ipcRenderer.invoke('memory:search', query, limit) as Promise<MemorySearchResult[]>,
    propose: (text: string, sessionId?: string, messageId?: string) => ipcRenderer.invoke('memory:propose', text, sessionId, messageId) as Promise<MemoryRecord[]>,
    create: (candidate: MemoryCandidateInput) => ipcRenderer.invoke('memory:create', candidate) as Promise<MemoryRecord>,
    approve: (id: string) => ipcRenderer.invoke('memory:approve', id) as Promise<MemoryRecord>,
    reject: (id: string) => ipcRenderer.invoke('memory:reject', id) as Promise<void>,
    conflicts: (candidateId?: string) => ipcRenderer.invoke('memory:conflicts', candidateId) as Promise<MemoryConflict[]>,
    resolveConflict: (candidateId: string, action: MemoryConflictAction) => ipcRenderer.invoke('memory:resolve-conflict', candidateId, action) as Promise<MemoryRecord | null>,
    history: (memoryId: string) => ipcRenderer.invoke('memory:history', memoryId) as Promise<MemoryRevision[]>,
    restoreRevision: (memoryId: string, revisionId: string) => ipcRenderer.invoke('memory:restore-revision', memoryId, revisionId) as Promise<MemoryRecord>,
    maintenance: () => ipcRenderer.invoke('memory:maintenance') as Promise<MemoryMaintenanceResult>,
    cleanupPreview: (limit?: number) => ipcRenderer.invoke('memory:cleanup-preview', limit) as Promise<MemoryCleanupSuggestion[]>,
    clusters: () => ipcRenderer.invoke('memory:clusters') as Promise<MemoryCluster[]>,
    createTopic: (label: string, memoryIds: string[]) => ipcRenderer.invoke('memory:create-topic', label, memoryIds) as Promise<MemoryCluster>,
    splitCluster: (clusterId: string, memoryIds: string[], manual: boolean) => ipcRenderer.invoke('memory:split-cluster', clusterId, memoryIds, manual) as Promise<string[]>,
    insights: () => ipcRenderer.invoke('memory:insights') as Promise<MemoryInsights>,
    importPreview: () => ipcRenderer.invoke('memory:import-preview') as Promise<MemoryImportPreview>,
    importCommit: (decisions: MemoryImportDecision[]) => ipcRenderer.invoke('memory:import-commit', decisions) as Promise<MemoryImportResult>,
    syncTest: () => ipcRenderer.invoke('memory:sync-test') as Promise<MemorySyncStatus>,
    syncPullPreview: () => ipcRenderer.invoke('memory:sync-pull-preview') as Promise<MemorySyncPullPreview>,
    syncPush: () => ipcRenderer.invoke('memory:sync-push') as Promise<MemorySyncPushResult>,
    archiveMany: (ids: string[]) => ipcRenderer.invoke('memory:archive-many', ids) as Promise<string[]>,
    reactivate: (memoryId: string) => ipcRenderer.invoke('memory:reactivate', memoryId) as Promise<MemoryRecord>,
    feedback: (memoryId: string, contextId: string, value: MemoryFeedbackValue) => ipcRenderer.invoke('memory:feedback', memoryId, contextId, value) as Promise<MemoryFeedbackResult>,
    update: (id: string, patch: { content?: string; type?: string; importance?: number; expiresAt?: number | null }) => ipcRenderer.invoke('memory:update', id, patch) as Promise<MemoryRecord>,
    delete: (id: string) => ipcRenderer.invoke('memory:delete', id) as Promise<void>,
    clear: () => ipcRenderer.invoke('memory:clear') as Promise<void>,
    export: () => ipcRenderer.invoke('memory:export') as Promise<{ ok: boolean; canceled: boolean; filePath?: string }>,
    testEmbedding: () => ipcRenderer.invoke('memory:test-embedding') as Promise<EmbeddingStatus>,
    rebuildEmbeddings: () => ipcRenderer.invoke('memory:rebuild-embeddings') as Promise<EmbeddingRebuildResult>
  },
  onTogglePanel: (callback: () => void) => {
    ipcRenderer.on('toggle-panel', callback)
    return () => {
      ipcRenderer.removeListener('toggle-panel', callback)
    }
  },
  onOpenSettings: (callback: () => void) => {
    ipcRenderer.on('open-settings', callback)
    return () => {
      ipcRenderer.removeListener('open-settings', callback)
    }
  },
  onHidePanel: (callback: () => void) => {
    ipcRenderer.on('hide-panel', callback)
    return () => {
      ipcRenderer.removeListener('hide-panel', callback)
    }
  },
  onPluginHotkey: (callback: (pluginId: string) => void) => {
    const handler = (_e: unknown, pluginId: string) => callback(pluginId)
    ipcRenderer.on('plugin-hotkey', handler)
    return () => { ipcRenderer.removeListener('plugin-hotkey', handler) }
  },
  onClipboardChange: (callback: (text: string) => void) => {
    const handler = (_e: unknown, text: string) => callback(text)
    ipcRenderer.on('clipboard:changed', handler)
    return () => { ipcRenderer.removeListener('clipboard:changed', handler) }
  },
  onConfigChanged: (callback: (config: AppConfig) => void) => {
    const handler = (_e: unknown, config: AppConfig) => callback(config)
    ipcRenderer.on('config:changed', handler)
    return () => { ipcRenderer.removeListener('config:changed', handler) }
  },
  db: {
    getConfig: () => ipcRenderer.invoke('db:get-config'),
    saveConfig: (cfg: Partial<AppConfig>) => ipcRenderer.invoke('db:save-config', cfg) as Promise<AppConfig>,
    getMessages: () => ipcRenderer.invoke('db:get-messages'),
    saveMessages: (msgs: unknown[]) => ipcRenderer.invoke('db:save-messages', msgs),
    clearMessages: () => ipcRenderer.invoke('db:clear-messages'),
    getSessionWorkspace: () => ipcRenderer.invoke('db:get-session-workspace'),
    createSession: (title?: string) => ipcRenderer.invoke('db:create-session', title),
    selectSession: (id: string) => ipcRenderer.invoke('db:select-session', id),
    renameSession: (id: string, title: string) => ipcRenderer.invoke('db:rename-session', id, title),
    deleteSession: (id: string) => ipcRenderer.invoke('db:delete-session', id),
    saveSessionMessages: (id: string, msgs: unknown[]) => ipcRenderer.invoke('db:save-session-messages', id, msgs),
    exportSession: (id: string) => ipcRenderer.invoke('db:export-session', id),
    getState: (key: string) => ipcRenderer.invoke('db:get-state', key),
    setState: (key: string, value: string) => ipcRenderer.invoke('db:set-state', key, value)
  },
  plugin: {
    execute: (pluginId: string, content: string) =>
      ipcRenderer.invoke(`plugin:${pluginId}:execute`, content),
    login: (pluginId: string, credentials: Record<string, string>) =>
      ipcRenderer.invoke(`plugin:${pluginId}:login`, credentials),
    logout: (pluginId: string) =>
      ipcRenderer.invoke(`plugin:${pluginId}:logout`),
    isAuthenticated: (pluginId: string) =>
      ipcRenderer.invoke(`plugin:${pluginId}:is-authenticated`),
    getPlugins: () =>
      ipcRenderer.invoke('plugin:get-plugins')
  },
  update: {
    onAvailable: (callback: (info: { version: string }) => void) => {
      const handler = (_e: unknown, info: { version: string }) => callback(info)
      ipcRenderer.on('update:available', handler)
      return () => { ipcRenderer.removeListener('update:available', handler) }
    },
    onNotAvailable: (callback: () => void) => {
      ipcRenderer.on('update:not-available', callback)
      return () => { ipcRenderer.removeListener('update:not-available', callback) }
    },
    onDownloading: (callback: () => void) => {
      ipcRenderer.on('update:downloading', callback)
      return () => { ipcRenderer.removeListener('update:downloading', callback) }
    },
    onProgress: (callback: (progress: { percent: number; transferred: number; total: number }) => void) => {
      const handler = (_e: unknown, progress: { percent: number; transferred: number; total: number }) => callback(progress)
      ipcRenderer.on('update:progress', handler)
      return () => { ipcRenderer.removeListener('update:progress', handler) }
    },
    onDownloaded: (callback: (info: { version: string }) => void) => {
      const handler = (_e: unknown, info: { version: string }) => callback(info)
      ipcRenderer.on('update:downloaded', handler)
      return () => { ipcRenderer.removeListener('update:downloaded', handler) }
    },
    onError: (callback: (message: string) => void) => {
      const handler = (_e: unknown, msg: string) => callback(msg)
      ipcRenderer.on('update:error', handler)
      return () => { ipcRenderer.removeListener('update:error', handler) }
    }
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)
