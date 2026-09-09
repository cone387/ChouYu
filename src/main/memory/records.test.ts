import { describe, expect, it, vi } from 'vitest'
import { allMemoryRecords, findMemoryByKey } from './records'
import type { MemoryRecord } from '../../shared/memory'
import type { MemoryProvider } from './provider'
const rows = Array.from({ length: 2101 }, (_, index) => ({ id: String(index), normalizedKey: `key${index}`, status: 'active' }) as MemoryRecord)
const listPage = vi.fn((options?: { offset?: number; limit?: number }) => ({ items: rows.slice(options?.offset || 0, (options?.offset || 0) + (options?.limit || 500)), total: rows.length, offset: options?.offset || 0, typeCounts: {} }))
describe('full memory reads', () => {
  it('reads all pages and provides a compatible duplicate lookup beyond 2000 records', () => {
    const provider = { listPage } as unknown as MemoryProvider
    expect(allMemoryRecords(provider)).toHaveLength(2101)
    expect(findMemoryByKey(provider, 'key2100')?.id).toBe('2100')
  })
  it('uses an indexed lookup when provided', () => {
    const lookup = vi.fn(() => rows[2100]), pages = vi.fn()
    expect(findMemoryByKey({ findByNormalizedKey: lookup, listPage: pages } as unknown as MemoryProvider, 'key2100', 'active')).toBe(rows[2100])
    expect(lookup).toHaveBeenCalledWith('key2100', 'active'); expect(pages).not.toHaveBeenCalled()
  })
  it('rejects inconsistent totals, duplicate records and non-progressing pages', () => {
    for (const kind of ['total', 'duplicate', 'empty', 'offset']) {
      const pages = vi.fn((options?: { offset?: number }) => options?.offset ? { items: kind === 'empty' ? [] : [rows[kind === 'duplicate' ? 0 : 500]], total: kind === 'total' ? 502 : 501, offset: kind === 'offset' ? 0 : 500, typeCounts: {} } : { items: rows.slice(0, 500), total: 501, offset: 0, typeCounts: {} })
      expect(() => allMemoryRecords({ listPage: pages })).toThrow('分页')
    }
  })
})
