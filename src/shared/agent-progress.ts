export interface AgentProgressUpdate {
  taskTitle: string
  title: string
  summary: string
  nextStep: string
  outcome: 'delivered' | 'updated' | 'completed' | 'abandoned'
}

export function sanitizeProgressUpdate(value: unknown): AgentProgressUpdate | undefined {
  if (!value || typeof value !== 'object') return
  const v = value as AgentProgressUpdate
  if (!['delivered', 'updated', 'completed', 'abandoned'].includes(v.outcome)) return
  if (![v.taskTitle, v.title, v.summary, v.nextStep].every(s => typeof s === 'string' && s.length <= 6000)) return
  return { taskTitle: v.taskTitle, title: v.title, summary: v.summary, nextStep: v.nextStep, outcome: v.outcome }
}

export const progressLabel = (outcome: AgentProgressUpdate['outcome']) => ({ delivered: '本轮成果已保存', updated: '本轮有新进展', completed: '任务已结束', abandoned: '已停止这个方向' })[outcome]

export function progressText(update: AgentProgressUpdate): string {
  return `${progressLabel(update.outcome)}：${update.title}\n\n${update.summary}\n\n任务：${update.taskTitle}${update.nextStep ? `\n\n接下来：${update.nextStep}` : ''}`
}

/** Display-only compatibility for the exact old template; never rewrite stored history. */
export function legacyProgressUpdate(content: string): AgentProgressUpdate | undefined {
  const match = /^「([^\n]+)」(有新的判断|有第一份成果了|已结束|已放弃)。\n\n当前判断：([\s\S]*?)\n\n变化原因：([\s\S]*?)(?:\n\n下一步：([\s\S]*))?$/.exec(content)
  if (!match) return
  const outcome = match[2] === '已结束' ? 'completed' : match[2] === '已放弃' ? 'abandoned' : 'updated'
  return { taskTitle: match[1], title: '', summary: match[3], nextStep: match[5] || '', outcome }
}
