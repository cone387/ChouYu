import type { AssistantMessageKind } from '../shared/assistant-message'
import type { StorageStatus } from '../shared/storage'
import { contextBridge, ipcRenderer } from 'electron'
import { createPendingEvent } from './pending-event'
import type { JournalAPI } from '../shared/journal'
import type { TasksAPI, TasksReminderEvent } from '../shared/tasks'
import type { AppConfig } from '../shared/config'
import type { AIModelListResult, AIStreamEvent, AIStreamRequest, AIStreamResult, ProviderDiagnostics } from '../shared/ai'
import type { CaptureSourceInfo, ScrollCaptureRegion, ScrollCaptureResult } from '../shared/capture'
import type { ToolApprovalRequest, ToolCatalogItem, ToolExecutionEvent } from '../shared/tools'
import type { CapabilityInfo } from '../shared/capabilities'
import type { EmbeddingRebuildResult, EmbeddingStatus, MemoryCandidateInput, MemoryCleanupSuggestion, MemoryCluster, MemoryConflict, MemoryConflictAction, MemoryFeedbackResult, MemoryFeedbackValue, MemoryImportDecision, MemoryImportPreview, MemoryImportResult, MemoryInsights, MemoryListOptions, MemoryMaintenanceResult, MemoryRecord, MemoryRevision, MemorySearchResult, MemoryStats, MemorySyncStatus } from '../shared/memory'

const openChatPanelEvent = createPendingEvent()
const openAssistantChatEvent = createPendingEvent()
ipcRenderer.on('open-chat-panel', () => openChatPanelEvent.emit())
ipcRenderer.on('open-assistant-chat', () => openAssistantChatEvent.emit())

const api = {
  journal: {
    retrySavedOcr: (id) => ipcRenderer.invoke('journal:retrySavedOcr', id),
    onBookmarkSaved: (callback) => {
      const handler = (_event: unknown, id: string) => callback(id)
      ipcRenderer.on('journal:bookmark-saved', handler)
      return () => { ipcRenderer.removeListener('journal:bookmark-saved', handler) }
    },
    generateContinuations: (input) => ipcRenderer.invoke('journal:generateContinuations', input),
    saveItem: (input) => ipcRenderer.invoke('journal:saveItem', input),
    savedImage: (input) => ipcRenderer.invoke('journal:savedImage', input),
    updateSaved: (input) => ipcRenderer.invoke('journal:updateSaved', input),
    deleteSaved: (input) => ipcRenderer.invoke('journal:deleteSaved', input),
    savedItems: () => ipcRenderer.invoke('journal:savedItems'),
    projects: () => ipcRenderer.invoke('journal:projects'),
    weeklySources: range => ipcRenderer.invoke('journal:weeklySources', range),
    weekly: () => ipcRenderer.invoke('journal:weekly'),
    createWeekly: input => ipcRenderer.invoke('journal:createWeekly', input),
    editWeekly: input => ipcRenderer.invoke('journal:editWeekly', input),
    deleteWeekly: input => ipcRenderer.invoke('journal:deleteWeekly', input),
    exportWeekly: input => ipcRenderer.invoke('journal:exportWeekly', input),
    playbook: () => ipcRenderer.invoke('journal:playbook'),
    savePlaybook: input => ipcRenderer.invoke('journal:savePlaybook', input),
    deletePlaybook: input => ipcRenderer.invoke('journal:deletePlaybook', input),
    exportPlaybook: input => ipcRenderer.invoke('journal:exportPlaybook', input),
    preparePlaybookMemory: input => ipcRenderer.invoke('journal:preparePlaybookMemory', input),
    confirmPlaybookMemory: token => ipcRenderer.invoke('journal:confirmPlaybookMemory', token),
    saveProject: input => ipcRenderer.invoke('journal:saveProject', input),
    deleteProject: id => ipcRenderer.invoke('journal:deleteProject', id),
    assignProject: input => ipcRenderer.invoke('journal:assignProject', input),
    prepareSemantic: query => ipcRenderer.invoke('journal:prepareSemantic', query),
    searchSemantic: id => ipcRenderer.invoke('journal:searchSemantic', id),
    clearSemanticCache: () => ipcRenderer.invoke('journal:clearSemanticCache'),
    cancelSemantic: () => ipcRenderer.invoke('journal:cancelSemantic'),
    savedUsage: () => ipcRenderer.invoke('journal:savedUsage'),
    open: () => ipcRenderer.invoke('journal:open'),
    status: () => ipcRenderer.invoke('journal:status'),
    configure: (patch) => ipcRenderer.invoke('journal:configure', patch),
    list: (query) => ipcRenderer.invoke('journal:list', query),
    tasks: (query) => ipcRenderer.invoke('journal:tasks', query),
    detail: (input) => ipcRenderer.invoke('journal:detail', input),
    editTask: (input) => ipcRenderer.invoke('journal:edit-task', input),
    deleteActivity: (id) => ipcRenderer.invoke('journal:delete-activity', id),
    deleteCapture: (id) => ipcRenderer.invoke('journal:delete-capture', id),
    captureInfo: (id) => ipcRenderer.invoke('journal:capture-info', id),
    deleteRange: (range) => ipcRenderer.invoke('journal:delete-range', range),
    captures: (query) => ipcRenderer.invoke('journal:captures', query),
    image: (id) => ipcRenderer.invoke('journal:image', id),
    retryOcr: (id) => ipcRenderer.invoke('journal:retry-ocr', id),
    summarize: (range) => ipcRenderer.invoke('journal:summarize', range),
    summary: (range) => ipcRenderer.invoke('journal:summary', range),
    analysisRecords: (range) => ipcRenderer.invoke('journal:analysis-records', range),
    overview: (range) => ipcRenderer.invoke('journal:overview', range),
    ask: (input) => ipcRenderer.invoke('journal:ask', input),
    cancelAnalysis: () => ipcRenderer.invoke('journal:cancel-analysis')
  } satisfies JournalAPI,
  tasks: {
    trash: () => ipcRenderer.invoke('tasks:trash'),
    restoreTrash: id => ipcRenderer.invoke('tasks:restoreTrash', id),
    purgeTrash: id => ipcRenderer.invoke('tasks:purgeTrash', id),
    exportBackup: settings => ipcRenderer.invoke('tasks:exportBackup', settings),
    selectBackup: () => ipcRenderer.invoke('tasks:selectBackup'),
    restoreBackup: (token, settings) => ipcRenderer.invoke('tasks:restoreBackup', token, settings),
    list: options => ipcRenderer.invoke('tasks:list', options),
    get: id => ipcRenderer.invoke('tasks:get', id),
    onChanged: callback => {
      const listener = () => callback()
      ipcRenderer.on('tasks:changed', listener)
      return () => { ipcRenderer.removeListener('tasks:changed', listener) }
    },
    create: input => ipcRenderer.invoke('tasks:create', input),
    update: (id, patch) => ipcRenderer.invoke('tasks:update', id, patch),
    complete: id => ipcRenderer.invoke('tasks:complete', id),
    reopen: id => ipcRenderer.invoke('tasks:reopen', id),
    remove: id => ipcRenderer.invoke('tasks:delete', id),
    projects: () => ipcRenderer.invoke('tasks:projects'),
    groups: () => ipcRenderer.invoke('tasks:groups'),
    createGroup: name => ipcRenderer.invoke('tasks:createGroup', name),
    renameGroup: (id, name) => ipcRenderer.invoke('tasks:renameGroup', id, name),
    deleteGroup: (id, deleteContents) => ipcRenderer.invoke('tasks:deleteGroup', id, deleteContents),
    moveProject: (id, groupId) => ipcRenderer.invoke('tasks:moveProject', id, groupId),
    createProject: (name, groupId) => ipcRenderer.invoke('tasks:createProject', name, groupId),
    renameProject: (id, name) => ipcRenderer.invoke('tasks:renameProject', id, name),
    archiveProject: (id, archived) => ipcRenderer.invoke('tasks:archiveProject', id, archived),
    deleteProject: id => ipcRenderer.invoke('tasks:deleteProject', id),
    views: () => ipcRenderer.invoke('tasks:views'),
    createView: input => ipcRenderer.invoke('tasks:createView', input),
    updateView: (id, patch) => ipcRenderer.invoke('tasks:updateView', id, patch),
    deleteView: id => ipcRenderer.invoke('tasks:deleteView', id),
    fields: () => ipcRenderer.invoke('tasks:fields'),
    createField: input => ipcRenderer.invoke('tasks:createField', input),
    updateField: (id, patch) => ipcRenderer.invoke('tasks:updateField', id, patch),
    deleteField: id => ipcRenderer.invoke('tasks:deleteField', id),
    ready: () => { ipcRenderer.send('tasks:ready') },
    onTasksReminder: callback => {
      const handler = (_event: unknown, payload: TasksReminderEvent) => callback(payload)
      ipcRenderer.on('tasks:reminder', handler)
      return () => { ipcRenderer.removeListener('tasks:reminder', handler) }
    },
    onOpenTasksPanel: callback => {
      const handler = (_event: unknown, taskId?: unknown) => callback(typeof taskId === 'string' ? taskId : undefined)
      ipcRenderer.on('open-tasks-panel', handler)
      return () => { ipcRenderer.removeListener('open-tasks-panel', handler) }
    },
    onTasksStoreRebuilt: callback => {
      ipcRenderer.on('tasks:store-rebuilt', callback)
      return () => { ipcRenderer.removeListener('tasks:store-rebuilt', callback) }
    }
  } satisfies TasksAPI,
  recognizeOfflineImage: (dataUrl: string) => ipcRenderer.invoke('ocr:offline', dataUrl) as Promise<import('../shared/ocr').OfflineOcrResult>,
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getSystemIdleSeconds: () => ipcRenderer.invoke('system-idle-seconds') as Promise<number>,
  quitApp: () => ipcRenderer.invoke('quit-app'),
  setAutoStart: (enabled: boolean) => ipcRenderer.invoke('set-auto-start', enabled),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  setIgnoreMouseEvents: (ignore: boolean) => {
    ipcRenderer.send('set-ignore-mouse-events', ignore)
  },
  onMouseEventsState: (callback: (ignored: boolean) => void) => {
    const handler = (_event: unknown, ignored: boolean) => callback(ignored)
    ipcRenderer.on('mouse-events-state', handler)
    return () => { ipcRenderer.removeListener('mouse-events-state', handler) }
  },
  onCursorPosition: (callback: (point: { x: number; y: number }) => void) => {
    const handler = (_event: unknown, point: { x: number; y: number }) => callback(point)
    ipcRenderer.on('cursor-position', handler)
    return () => { ipcRenderer.removeListener('cursor-position', handler) }
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
  captureScrollRegion: (region: ScrollCaptureRegion) =>
    ipcRenderer.invoke('capture-scroll-region', region) as Promise<ScrollCaptureResult>,
  onScrollCaptureProgress: (callback: (info: { frames: number }) => void) => {
    const handler = (_event: unknown, info: { frames: number }) => callback(info)
    ipcRenderer.on('scroll-capture:progress', handler)
    return () => { ipcRenderer.removeListener('scroll-capture:progress', handler) }
  },
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  fetchModels: () => ipcRenderer.invoke('fetch-models') as Promise<AIModelListResult>,
  diagnoseProvider: () => ipcRenderer.invoke('diagnose-provider') as Promise<ProviderDiagnostics>,
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
  capabilities: {
    list: () => ipcRenderer.invoke('capabilities:list') as Promise<CapabilityInfo[]>
  },
  memory: {
    list: (options?: MemoryListOptions) => ipcRenderer.invoke('memory:list', options) as Promise<MemoryRecord[]>,
    listPage: (options?: MemoryListOptions) => ipcRenderer.invoke('memory:list-page', options) as Promise<import('../shared/memory').MemoryListPage>,
    refreshRemoteList: () => ipcRenderer.invoke('memory:refresh-remote-list') as Promise<{ refreshedAt: number; remoteCount: number; removed: number; complete: boolean }>,
    identity: () => ipcRenderer.invoke('memory:identity') as Promise<MemoryRecord | null>,
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
    engineTest: () => ipcRenderer.invoke('memory:engine-test') as Promise<MemorySyncStatus>,
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
  onSetPetVisible: (callback: (visible: boolean) => void) => {
    const handler = (_e: unknown, visible: boolean) => callback(visible)
    ipcRenderer.on('set-pet-visible', handler)
    return () => { ipcRenderer.removeListener('set-pet-visible', handler) }
  },
  notifyPetVisible: (visible: boolean) => {
    ipcRenderer.send('pet-visibility-changed', visible)
  },
  proactiveAppend: (content: string, timestamp?: number, kind?: AssistantMessageKind) => ipcRenderer.invoke('proactive:append', content, timestamp, kind) as Promise<void>,
  getAssistantUnread: () => ipcRenderer.invoke('proactive:get-unread') as Promise<number>,
  onSessionsChanged: (callback: () => void) => {
    ipcRenderer.on('sessions:changed', callback)
    return () => { ipcRenderer.removeListener('sessions:changed', callback) }
  },
  onAssistantUnread: (callback: (count: number) => void) => {
    const handler = (_e: unknown, count: number) => callback(count)
    ipcRenderer.on('assistant-unread-changed', handler)
    return () => { ipcRenderer.removeListener('assistant-unread-changed', handler) }
  },
  onOpenAssistantChat: (callback: () => void) => openAssistantChatEvent.subscribe(callback),
  onOpenChatPanel: (callback: () => void) => openChatPanelEvent.subscribe(callback),
  onOpenJournalPanel: (callback: () => void) => {
    ipcRenderer.on('open-journal-panel', callback)
    return () => { ipcRenderer.removeListener('open-journal-panel', callback) }
  },
  onConfigChanged: (callback: (config: AppConfig) => void) => {
    const handler = (_e: unknown, config: AppConfig) => callback(config)
    ipcRenderer.on('config:changed', handler)
    return () => { ipcRenderer.removeListener('config:changed', handler) }
  },
  characters: {
    list: () => ipcRenderer.invoke('characters:list'),
    create: (draft: unknown) => ipcRenderer.invoke('characters:create', draft),
    update: (id: string, draft: unknown) => ipcRenderer.invoke('characters:update', id, draft),
    remove: (id: string) => ipcRenderer.invoke('characters:delete', id),
    fetchModels: (profileId: string) => ipcRenderer.invoke('characters:fetch-models', profileId) as Promise<AIModelListResult>,
    onChanged: (callback: () => void) => {
      ipcRenderer.on('characters:changed', callback)
      return () => { ipcRenderer.removeListener('characters:changed', callback) }
    }
  },
  providerProfiles: {
    list: () => ipcRenderer.invoke('provider-profiles:list'),
    save: (profile: unknown) => ipcRenderer.invoke('provider-profiles:save', profile),
    remove: (id: string) => ipcRenderer.invoke('provider-profiles:delete', id)
  },
  db: {
    getStorageStatus: () => ipcRenderer.invoke('db:storage-status') as Promise<StorageStatus>,
    retrySave: () => ipcRenderer.invoke('db:retry-save') as Promise<StorageStatus>,
    dismissStorageNotice: () => ipcRenderer.invoke('db:dismiss-storage-notice') as Promise<StorageStatus>,
    openDataDirectory: () => ipcRenderer.invoke('db:open-data-directory') as Promise<string>,
    onStorageStatus: (callback: (status: StorageStatus) => void) => {
      const handler = (_event: unknown, status: StorageStatus) => callback(status)
      ipcRenderer.on('db:storage-status', handler)
      return () => { ipcRenderer.removeListener('db:storage-status', handler) }
    },
    getConfig: () => ipcRenderer.invoke('db:get-config'),
    saveConfig: (cfg: Partial<AppConfig>) => ipcRenderer.invoke('db:save-config', cfg) as Promise<AppConfig>,
    getMessages: () => ipcRenderer.invoke('db:get-messages'),
    saveMessages: (msgs: unknown[]) => ipcRenderer.invoke('db:save-messages', msgs),
    clearMessages: () => ipcRenderer.invoke('db:clear-messages'),
    getSessionWorkspace: () => ipcRenderer.invoke('db:get-session-workspace'),
    searchSessions: (query: string) => ipcRenderer.invoke('db:search-sessions', query),
    createSession: (title?: string, characterId?: string) => ipcRenderer.invoke('db:create-session', title, characterId),
    selectSession: (id: string) => ipcRenderer.invoke('db:select-session', id),
    renameSession: (id: string, title: string) => ipcRenderer.invoke('db:rename-session', id, title),
    deleteSession: (id: string) => ipcRenderer.invoke('db:delete-session', id),
    saveSessionMessages: (id: string, msgs: unknown[]) => ipcRenderer.invoke('db:save-session-messages', id, msgs),
    markSessionRead: (id: string) => ipcRenderer.invoke('db:mark-session-read', id),
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
