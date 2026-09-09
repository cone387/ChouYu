export interface JournalPlaybookInput {
  id?: string; revision?: number; title: string; problem: string; attempts: string; resolution: string
  status: 'open' | 'resolved'; projectId: string | null; sourceIds: string[]
}
export interface JournalPlaybookEntry extends JournalPlaybookInput {
  id: string; revision: number; createdAt: number; updatedAt: number; missingSourceIds: string[]
}
export interface JournalPlaybookMemoryInput {
  id: string; revision: number; content: string; sensitive: boolean
}
export interface JournalPlaybookMemoryPlan {
  token: string; content: string; sensitive: boolean; destination: string; indexing: string; expiresAt: number
}
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)

export function validateJournalPlaybook(input: JournalPlaybookInput): JournalPlaybookInput {
  if (!input || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120 || typeof input.problem !== 'string' || !input.problem.trim() || input.problem.length > 4000 || typeof input.attempts !== 'string' || input.attempts.length > 8000 || typeof input.resolution !== 'string' || input.resolution.length > 4000) throw new Error('填写标题和问题；标题最多 120 字，问题/解决办法最多 4000 字，尝试过程最多 8000 字。')
  if (!['open', 'resolved'].includes(input.status) || input.status === 'resolved' && !input.resolution.trim()) throw new Error('标记已解决前请填写解决办法。')
  if (input.id !== undefined && (!uuid(input.id) || !Number.isSafeInteger(input.revision) || input.revision! < 1) || input.id === undefined && input.revision !== undefined) throw new Error('手册版本无效，请重新加载。')
  if (input.projectId !== null && !uuid(input.projectId) || !Array.isArray(input.sourceIds) || input.sourceIds.length > 10 || new Set(input.sourceIds).size !== input.sourceIds.length || input.sourceIds.some(id => !uuid(id))) throw new Error('项目或来源无效，每条手册最多关联 10 份不同收藏。')
  return { id: input.id, revision: input.revision, title: input.title.trim(), problem: input.problem.trim(), attempts: input.attempts.trim(), resolution: input.resolution.trim(), status: input.status, projectId: input.projectId, sourceIds: [...input.sourceIds] }
}

export function playbookMarkdown(entry: JournalPlaybookEntry): string {
  const line = (text: string) => text.replace(/[\r\n]+/g, ' ')
  return `# ${line(entry.title)}\n\n状态：${entry.status === 'resolved' ? '手动标记已解决' : '待解决'}\n\n## 问题\n\n${entry.problem}\n\n## 尝试过程\n\n${entry.attempts || '尚未记录'}\n\n## 解决办法\n\n${entry.resolution || '尚未确认'}\n\n## 来源\n\n${entry.sourceIds.length ? entry.sourceIds.map(id => `- 收藏 ${id}${entry.missingSourceIds.includes(id) ? '（已删除，无法回看）' : '（请在应用内回看）'}`).join('\n') : '未关联来源'}\n`
}
