import type { MemoryListOptions, MemoryRecord } from '../../shared/memory'
import type { MemoryProvider } from './provider'

/** Full-data operations must not inherit the UI's page-size ceiling. */
export function allMemoryRecords(provider: Pick<MemoryProvider, 'listPage'>, options: Omit<MemoryListOptions, 'limit' | 'offset'> = {}): MemoryRecord[] {
  const records: MemoryRecord[] = []
  const seen = new Set<string>()
  let total: number | undefined
  let offset = 0
  while (true) {
    const page = provider.listPage({ ...options, offset, limit: 500 })
    if (!Number.isSafeInteger(page.total) || page.total < 0 || total !== undefined && page.total !== total || page.offset !== offset || page.items.length > 500 || offset + page.items.length > page.total || page.total > offset && !page.items.length || page.items.some(item => seen.has(item.id))) throw new Error('记忆分页数据发生变化，请刷新后重试。')
    total = page.total
    for (const item of page.items) { if (seen.has(item.id)) throw new Error('记忆分页返回重复记录。'); seen.add(item.id) }
    records.push(...page.items)
    offset += page.items.length
    if (offset >= page.total) return records
  }
}
export function findMemoryByKey(provider: MemoryProvider, key: string, status?: 'active' | 'pending'): MemoryRecord | undefined {
  if (provider.findByNormalizedKey) return provider.findByNormalizedKey(key, status)
  return allMemoryRecords(provider, { status: status || 'all' }).find(memory => memory.normalizedKey === key && memory.status !== 'archived')
}
