export interface JournalWeeklyRange { from: number; to: number }
export interface JournalWeeklySource {
  id: string; signature: string; title: string; note: string; nextStep: string
  kind: 'activity' | 'progress' | 'blocker' | 'decision'; completed: boolean
  project: string; at: number
}
export interface JournalWeeklyCreate extends JournalWeeklyRange { sources: Array<{ id: string; signature: string }> }
export interface JournalWeeklyDraft extends JournalWeeklyRange {
  id: string; revision: number; title: string; markdown: string; createdAt: number; updatedAt: number
  sourceIds: string[]; missingSourceIds: string[]
}
export interface JournalWeeklyEdit { id: string; revision: number; title: string; markdown: string }

export function validateWeeklyRange(value: JournalWeeklyRange): JournalWeeklyRange {
  if (!value || !Number.isSafeInteger(value.from) || !Number.isSafeInteger(value.to) || value.from < 0 || value.to <= value.from || value.to > 8_640_000_000_000_000 || value.to - value.from > 8 * 86_400_000) throw new Error('请选择不超过 8 天的有效周报范围。')
  return { from: value.from, to: value.to }
}
export function weeklyDate(value: number): string {
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function weeklyMarkdown(range: JournalWeeklyRange, sources: JournalWeeklySource[]): string {
  validateWeeklyRange(range)
  const inline = (value: string) => value.replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}\[\]<>#]/g, '\\$&')
  const section = (name: string, items: JournalWeeklySource[]) => `## ${name}\n\n${items.length ? items.map(item => `- ${inline(item.title)}${item.project ? `（${inline(item.project)}）` : ''}\n  - 来源日期：${weeklyDate(item.at)}；收藏：${item.id}${item.note ? `\n  - 备注：${inline(item.note)}` : ''}${!item.completed && item.nextStep ? `\n  - 下一步建议（请核对）：${inline(item.nextStep)}` : ''}`).join('\n') : '本次未选取此类事项。'}\n`
  return `日期：${weeklyDate(range.from)} 至 ${weeklyDate(range.to - 1)}\n\n> 草稿由你选取确认的收藏整理。日期按来源发生时间，完成状态为生成时的手动标记；不代表完成日期或精确工时。请编辑核对后使用。\n\n${section('已确认进展', sources.filter(item => item.completed && item.kind !== 'decision'))}\n${section('已确认决定', sources.filter(item => item.kind === 'decision'))}\n${section('未完成与下一步', sources.filter(item => !item.completed && item.kind !== 'decision'))}`
}
export function weeklyExport(draft: JournalWeeklyDraft): string {
  return `# ${draft.title.replace(/[\r\n]+/g, ' ')}\n\n${draft.markdown}\n\n## 来源可用性\n\n${draft.sourceIds.map(id => `- 收藏 ${id}（${draft.missingSourceIds.includes(id) ? '已删除，无法回看' : '请在应用内回看'}）`).join('\n')}\n`
}
