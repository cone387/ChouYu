import type {
  MemoryCandidateInput,
  MemoryArchiveReason,
  MemoryCleanupSuggestion,
  MemoryConflict,
  MemoryConflictAction,
  MemoryConflictKind,
  MemoryFeedbackResult,
  MemoryFeedbackValue,
  MemoryListOptions,
  MemoryRecord,
  MemoryRevision,
  MemorySearchResult,
  MemoryStats,
  MemoryTopic,
  MemoryType
} from '../../shared/memory'

export interface MemoryUpdate {
  content?: string
  type?: MemoryType
  importance?: number
  expiresAt?: number | null
}

export interface MemoryEmbeddingRecord {
  memory: MemoryRecord
  vector: number[]
}

export interface MemoryProvider {
  initialize(): void
  close(): void
  list(options?: MemoryListOptions): MemoryRecord[]
  createCandidate(candidate: MemoryCandidateInput): MemoryRecord | null
  createActive(candidate: MemoryCandidateInput): MemoryRecord
  createActiveConfirmed?(candidate: MemoryCandidateInput): Promise<MemoryRecord>
  approve(id: string): MemoryRecord
  approveConfirmed?(id: string): Promise<MemoryRecord>
  reject(id: string): void
  rejectConfirmed?(id: string): Promise<void>
  archive(id: string, reason?: MemoryArchiveReason): void
  archiveMany(ids: string[], reason: MemoryArchiveReason): string[]
  archiveManyConfirmed?(ids: string[], reason: MemoryArchiveReason): Promise<string[]>
  reactivate(id: string): MemoryRecord
  reactivateConfirmed?(id: string): Promise<MemoryRecord>
  expireDue(now?: number): string[]
  enforceCapacity(maxItems: number): string[]
  cleanupCandidates(limit?: number): MemoryCleanupSuggestion[]
  recordFeedback(memoryId: string, contextId: string, value: MemoryFeedbackValue): MemoryFeedbackResult
  update(id: string, patch: MemoryUpdate): MemoryRecord
  updateConfirmed?(id: string, patch: MemoryUpdate): Promise<MemoryRecord>
  delete(id: string): void
  deleteConfirmed?(id: string): Promise<void>
  clear(): void
  clearConfirmed?(): Promise<void>
  search(query: string, limit?: number): MemorySearchResult[]
  stats(): MemoryStats
  exportAll(): MemoryRecord[]
  upsertEmbedding(memoryId: string, model: string, vector: number[]): void
  getEmbeddings(model: string): MemoryEmbeddingRecord[]
  clearEmbeddings(model?: string): void
  createConflict(candidateId: string, existingMemoryId: string, kind: MemoryConflictKind, reason: string): MemoryConflict
  listConflicts(candidateId?: string): MemoryConflict[]
  resolveConflict(candidateId: string, action: MemoryConflictAction): MemoryRecord | null
  resolveConflictConfirmed?(candidateId: string, action: MemoryConflictAction): Promise<MemoryRecord | null>
  listRevisions(memoryId: string): MemoryRevision[]
  restoreRevision(memoryId: string, revisionId: string): MemoryRecord
  restoreRevisionConfirmed?(memoryId: string, revisionId: string): Promise<MemoryRecord>
  listTopics(): MemoryTopic[]
  createTopic(label: string, memoryIds: string[]): MemoryTopic
  splitTopic(topicId: string): string[]
  excludeFromClusters(memoryIds: string[]): string[]
  listClusterExcludedIds(): string[]
}
