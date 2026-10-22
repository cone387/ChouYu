import type { EmbeddingRebuildResult, EmbeddingStatus, MemoryCandidateInput, MemoryCleanupSuggestion, MemoryCluster, MemoryConflict, MemoryConflictAction, MemoryFeedbackResult, MemoryFeedbackValue, MemoryImportDecision, MemoryImportPreview, MemoryImportResult, MemoryInsights, MemoryListOptions, MemoryMaintenanceResult, MemoryRecord, MemoryRevision, MemorySearchResult, MemoryStats, MemorySyncStatus } from '../../shared/memory'
import type { IpcRenderer } from 'electron'

export function createMemoryBridge(ipcRenderer: IpcRenderer) {

return {
  memory: {
    list: (options?: MemoryListOptions) => ipcRenderer.invoke('memory:list', options) as Promise<MemoryRecord[]>,
    listPage: (options?: MemoryListOptions) => ipcRenderer.invoke('memory:list-page', options) as Promise<import('../../shared/memory').MemoryListPage>,
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
  }
}
}
