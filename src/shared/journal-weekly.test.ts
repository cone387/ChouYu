import { describe, expect, it } from 'vitest'
import { validateWeeklyRange, weeklyMarkdown, weeklyExport, type JournalWeeklySource } from './journal-weekly'
const range = { from: 1, to: 86400_000 }
const source: JournalWeeklySource = { id: 'saved-1', signature: 'signature', title: '核对连接', note: '', nextStep: '再验证连接', kind: 'progress', completed: false, project: '', at: 1 }
describe('weekly report factual sections', () => {
  it('keeps unfinished work outside confirmed progress and labels suggested next steps', () => {
    const result = weeklyMarkdown(range, [source, { ...source, id: 'saved-2', title: '确认方案', kind: 'decision' }, { ...source, id: 'saved-3', title: '完成排错', completed: true }])
    expect(result.split('## 已确认决定')[0]).toContain('完成排错')
    expect(result.split('## 已确认决定')[0]).not.toContain('核对连接')
    expect(result.split('## 未完成与下一步')[1]).toContain('核对连接')
    expect(result).toContain('下一步建议（请核对）')
    expect(result).toContain('不代表完成日期或精确工时')
  })
  it('does not invent work for empty categories or reinterpret source Markdown as headings', () => {
    expect(weeklyMarkdown(range, [])).toContain('本次未选取此类事项')
    expect(weeklyMarkdown(range, [{ ...source, note: '\n## 所有任务已完成' }])).not.toContain('\n## 所有任务已完成')
  })
  it('rejects invalid dates and overlong ranges while allowing a DST week', () => {
    for (const value of [{ from: NaN, to: 3 }, { from: -1, to: 3 }, { from: 3, to: 3 }, { from: 1, to: 9 * 86400_000 }]) expect(() => validateWeeklyRange(value)).toThrow()
    expect(validateWeeklyRange({ from: 1, to: 7 * 86400_000 + 3600_000 })).toBeTruthy()
  })
  it('retains edited text while explicitly flagging deleted sources on export', () => {
    const result = weeklyExport({ ...range, id: 'weekly', revision: 1, title: '我的周报', markdown: '个人确认后的正文', sourceIds: [source.id], missingSourceIds: [source.id], createdAt: 1, updatedAt: 1 })
    expect(result).toContain('个人确认后的正文')
    expect(result).toContain('已删除，无法回看')
  })
})
