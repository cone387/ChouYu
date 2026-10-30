import { randomUUID } from 'node:crypto'
import type { AIResponseMetadata } from '../../shared/ai-usage'
import { UsageStore } from './store'

let store: UsageStore | undefined
let notifyFailure: (() => void) | undefined
let failed = false
export function initializeUsage(directory: string, onFailure?: () => void): void {
  closeUsage()
  notifyFailure = onFailure
  try { store = new UsageStore(directory) }
  catch { markUsageCollectionIssue() }
}
export function closeUsage(): void { store?.close(); store = undefined; notifyFailure = undefined; failed = false }
export function markUsageCollectionIssue(): void {
  try { store?.markCollectionIssue() } catch { /* Keep the in-memory marker even if storage is unavailable. */ }
  if (!failed) {
    failed = true
    console.warn('[Usage] Token usage collection is incomplete.')
    try { notifyFailure?.() } catch { /* Telemetry cannot interrupt execution. */ }
  }
}
export function getUsageStore(): UsageStore {
  if (!store) throw new Error(failed ? 'Token 用量存储暂时不可用，当前无法读取统计。' : 'Token 用量统计尚未初始化。')
  return store
}
/** Telemetry failure must not replay or interrupt a model request. */
export function beginUsageCall(model: string): { update(metadata: AIResponseMetadata): void } {
  const target = store, id = randomUUID()
  let last = ''
  const safely = (write: () => void) => { try { write() } catch { markUsageCollectionIssue() } }
  if (target) safely(() => target.begin(id, model))
  return { update(metadata) {
    if (!target) return
    const snapshot = JSON.stringify({ model: metadata.model, usage: metadata.usage })
    if (snapshot === last) return
    safely(() => { target.update(id, metadata); last = snapshot })
  } }
}
