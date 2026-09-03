import type { MemoryRecord } from '../../../shared/memory'

export interface RemoteMemoryRecord {
  id: string
  content: string
  metadata: Record<string, unknown>
  createdAt?: number
}

export interface MemorySyncAdapter {
  readonly provider: 'mem0'
  test(signal?: AbortSignal): Promise<{ remoteCount: number }>
  list(signal?: AbortSignal): Promise<RemoteMemoryRecord[]>
  search(query: string, limit?: number, signal?: AbortSignal): Promise<RemoteMemoryRecord[]>
  push(memories: readonly MemoryRecord[], signal?: AbortSignal): Promise<{ attempted: number; succeeded: number; skipped: number; failed: number }>
}
