import type {
  MemoryCandidateInput,
  MemoryConflict,
  MemoryConflictAction,
  MemoryConflictKind,
  MemoryListOptions,
  MemoryRecord,
  MemoryRevision,
  MemorySearchResult,
  MemoryStats,
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
  approve(id: string): MemoryRecord
  reject(id: string): void
  archive(id: string, reason?: string): void
  update(id: string, patch: MemoryUpdate): MemoryRecord
  delete(id: string): void
  clear(): void
  search(query: string, limit?: number): MemorySearchResult[]
  stats(): MemoryStats
  exportAll(): MemoryRecord[]
  upsertEmbedding(memoryId: string, model: string, vector: number[]): void
  getEmbeddings(model: string): MemoryEmbeddingRecord[]
  clearEmbeddings(model?: string): void
  createConflict(candidateId: string, existingMemoryId: string, kind: MemoryConflictKind, reason: string): MemoryConflict
  listConflicts(candidateId?: string): MemoryConflict[]
  resolveConflict(candidateId: string, action: MemoryConflictAction): MemoryRecord | null
  listRevisions(memoryId: string): MemoryRevision[]
  restoreRevision(memoryId: string, revisionId: string): MemoryRecord
}
