import { describe, expect, it } from 'vitest'
import { DEFAULT_JOURNAL_CONFIG } from '../../shared/journal'
import { capacityNotice, cleanupTarget, DISK_RESERVE_BYTES } from './storage-budget'

describe('capture storage budget', () => {
  const config = { ...DEFAULT_JOURNAL_CONFIG, maxStorageMB: 256 }
  const limit = 256 * 1024 ** 2
  it('requires cleanup opt-in and leaves headroom after cleanup', () => {
    expect(cleanupTarget(config, limit, 100)).toBeNull()
    expect(cleanupTarget({ ...config, autoCleanup: true }, limit, 100)).toBe(limit * 0.9)
    expect(cleanupTarget({ ...config, autoCleanup: true }, 100, 100)).toBeNull()
  })
  it('supports unlimited quota while always enforcing free disk space', () => {
    const unlimited = { ...config, maxStorageMB: 0, autoCleanup: true }
    expect(cleanupTarget(unlimited, limit * 100, 100)).toBeNull()
    expect(capacityNotice(unlimited, limit * 100, 100, DISK_RESERVE_BYTES + 100)).toBeNull()
    expect(capacityNotice(unlimited, 0, 100, DISK_RESERVE_BYTES)).toContain('磁盘')
  })
  it('checks incoming bytes against the quota before accepting a frame', () => {
    expect(capacityNotice(config, limit - 100, 100, DISK_RESERVE_BYTES * 2)).toBeNull()
    expect(capacityNotice(config, limit - 100, 101, DISK_RESERVE_BYTES * 2)).toContain('存储已达上限')
  })
})
