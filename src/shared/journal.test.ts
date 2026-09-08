import { describe, expect, it } from 'vitest'
import { DEFAULT_JOURNAL_CONFIG, migrateJournalConfig, validateJournalConfig, validateJournalQuery } from './journal'

describe('journal boundaries', () => {
  it('starts with activity and local OCR capture enabled and preserves omitted values', () => {
    expect(DEFAULT_JOURNAL_CONFIG).toMatchObject({ enabled: true, captureEnabled: true, captureIntervalSeconds: 5, maxStorageMB: 2048 })
    expect(validateJournalConfig({ enabled: undefined, paused: true }, DEFAULT_JOURNAL_CONFIG)).toMatchObject({ enabled: true, paused: true })
  })
  it('upgrades the legacy preset once but preserves subsequent opt-out and custom choices', () => {
    const old = { enabled: false, captureEnabled: false, captureIntervalSeconds: 20, maxStorageMB: 512, paused: true }
    expect(migrateJournalConfig(old, 2)).toMatchObject({ enabled: true, captureEnabled: true, captureIntervalSeconds: 5, maxStorageMB: 2048, paused: true })
    expect(migrateJournalConfig(old, 3)).toMatchObject(old)
    expect(migrateJournalConfig({ ...old, captureIntervalSeconds: 60 }, 2)).toMatchObject({ enabled: false, captureEnabled: false, captureIntervalSeconds: 60 })
    expect(migrateJournalConfig({ enabled: true }, 1)).toMatchObject({ enabled: true, captureEnabled: true, captureIntervalSeconds: 5 })
  })
  it('rejects invalid retention, arbitrary paths and nonboolean enablement', () => {
    for (const patch of [{ retentionDays: 0 }, { enabled: 'true' }, { excludedApps: ['C:\\secret.exe'] }, { unexpected: true }]) {
      expect(() => validateJournalConfig(patch, DEFAULT_JOURNAL_CONFIG)).toThrow()
    }
  })
  it('normalizes process matching without modifying the defaults', () => {
    expect(validateJournalConfig({ excludedApps: ['Chrome.exe', 'chrome.exe'] }, DEFAULT_JOURNAL_CONFIG).excludedApps).toEqual(['chrome.exe'])
    expect(DEFAULT_JOURNAL_CONFIG.excludedApps).not.toContain('chrome.exe')
  })
  it('bounds date queries and pagination', () => {
    for (const query of [{ from: NaN, to: 10 }, { from: 10, to: 9 }, { from: 0, to: 33 * 86400_000 }, { from: 0, to: 10, offset: -1 }]) expect(() => validateJournalQuery(query)).toThrow()
    expect(validateJournalQuery({ from: 0, to: 86400_000, query: ' 项目 ' })).toEqual({ from: 0, to: 86400_000, query: '项目', offset: 0 })
  })
})
