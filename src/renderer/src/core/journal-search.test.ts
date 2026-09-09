import { describe, expect, it } from 'vitest'
import { journalSearchExcerpt, journalSearchRange } from './journal-search'

describe('cross-day journal search', () => {
  it('includes the end date and rejects invalid or excessive calendar ranges', () => {
    expect(journalSearchRange('2026-09-08', '2026-09-09')).toEqual({ from: new Date(2026, 8, 8).getTime(), to: new Date(2026, 8, 10).getTime() })
    expect(() => journalSearchRange('2026-02-30', '2026-03-01')).toThrow()
    expect(() => journalSearchRange('2026-09-09', '2026-09-08')).toThrow()
    expect(() => journalSearchRange('2026-08-01', '2026-09-01')).toThrow()
    expect(() => journalSearchRange('2026-08-01', '2026-08-31')).not.toThrow()
  })
  it('shows an OCR match beyond the beginning of long text', () => {
    const excerpt = journalSearchExcerpt('前文'.repeat(200) + '\n跨日证据\n' + '后文'.repeat(200), '跨日证据')
    expect(excerpt).toContain('跨日证据')
    expect(excerpt.length).toBeLessThanOrEqual(152)
    expect(excerpt).not.toContain('\n')
  })
})
