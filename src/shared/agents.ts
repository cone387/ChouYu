export interface AgentSettings {
  permissionLevel?: 'public' | 'sources'
  goal: string
  sources: string[]
  intervalMinutes: number
  dailyCalls: number
  enabled: boolean
  notifyProgress?: boolean
  searchEnabled?: boolean
  dailySearches?: number
}
export interface AgentResearchPlan { action: 'search' | 'read' | 'wait'; reason: string; query: string; urls: string[]; checkAfterMinutes: number }
export interface AgentSearchResult { url: string; title: string }
export interface AgentSearchRecord { query: string; at: number; results: AgentSearchResult[]; error?: string }
export interface AgentResearch { plan: AgentResearchPlan; searches: AgentSearchRecord[]; reads: { url: string; status: 'read' | 'failed'; hash?: string }[]; nextCheckAt?: number; unchanged?: boolean }
export interface AgentMessageRef { topicId: string; runId: string; kind: 'question' | 'progress' }
export interface AgentNotice extends AgentMessageRef { id: string; characterId: string; topicRevision: number; content: string; createdAt: number }
export interface AgentFocusRequest extends AgentMessageRef { tab: 'work' | 'history'; nonce: number }
export function sanitizeAgentMessageRef(value: unknown): AgentMessageRef | undefined {
  if (!value || typeof value !== 'object') return undefined
  const ref = value as AgentMessageRef
  if (!['progress', 'question'].includes(ref.kind) || ![ref.topicId, ref.runId].every(id => typeof id === 'string' && id.length > 0 && id.length <= 128)) return undefined
  return { topicId: ref.topicId, runId: ref.runId, kind: ref.kind }
}
export const DEFAULT_AGENT_SETTINGS: AgentSettings = { goal: '', sources: [], intervalMinutes: 180, dailyCalls: 8, enabled: false }
export function agentUsesPlanner(settings: AgentSettings): boolean {
  return settings.permissionLevel !== 'sources' && (settings.searchEnabled === true || settings.sources.length === 0)
}
export type AgentRunStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export interface AgentEvidence { url: string; title: string; text: string; capturedAt: number; hash: string }
export interface AgentRun {
  id: string; characterId: string; revision: number; status: AgentRunStatus; createdAt: number; updatedAt: number
  topicId: string | null
  question: string; answer: string; summary: string; error: string
}
export interface AgentEvent { id: number; runId: string; kind: string; text: string; at: number }
export interface AgentMemory { id: string; content: string; runId: string | null; createdAt: number }
export interface AgentReport { runId: string; title: string; body: string; nextStep: string; evidence: AgentEvidence[]; createdAt: number }
export interface AgentOverview {
  searchesToday?: number
  settings: AgentSettings; revision: number; nextAt: number; callsToday: number
  runs: AgentRun[]; memories: AgentMemory[]; reports: AgentReport[]
  topics: AgentTopic[]; focusTopicId: string | null
}
export const TOPIC_STATUS = { planned: '待研究', researching: '研究中', needs_evidence: '待补证据', paused: '已暂停', completed: '已结束', abandoned: '已放弃' } as const
export type AgentTopicStatus = keyof typeof TOPIC_STATUS
export interface AgentTopicInput { title: string; goal: string; constraints: string }
export interface AgentTopic extends AgentTopicInput {
  id: string; characterId: string; revision: number; status: AgentTopicStatus
  judgement: string; openQuestions: string; nextStep: string; reason: string; createdAt: number; updatedAt: number
}
export interface AgentTopicProgress {
  judgement: string; openQuestions: string; nextStep: string; reason: string
  status: 'researching' | 'needs_evidence' | 'completed' | 'abandoned'
}
export interface AgentTopicChange {
  id: number; kind: string; before: AgentTopic | null; after: AgentTopic; reason: string; runId: string | null; createdAt: number
}
export interface AgentTopicDetail { topic: AgentTopic; changes: AgentTopicChange[]; nextCursor: number | null }
export function validateTopicInput(raw: unknown): AgentTopicInput {
  if (!raw || typeof raw !== 'object') throw new Error('事项内容无效。')
  const value = raw as AgentTopicInput
  for (const [key, max, required] of [['title', 160, true], ['goal', 2000, true], ['constraints', 2000, false]] as const) {
    if (typeof value[key] !== 'string' || value[key].length > max || required && !value[key].trim()) throw new Error(`请填写有效的事项${key === 'title' ? '标题' : key === 'goal' ? '目标' : '约束'}（最多 ${max} 字）。`)
  }
  return { title: value.title.trim(), goal: value.goal.trim(), constraints: value.constraints.trim() }
}
export function validateTopicProgress(raw: unknown): AgentTopicProgress {
  if (!raw || typeof raw !== 'object') throw new Error('模型未返回事项进展。')
  const value = raw as AgentTopicProgress
  if (!['researching', 'needs_evidence', 'completed', 'abandoned'].includes(value.status)) throw new Error('事项状态无效，不能将推测标为已验证。')
  for (const [key, max] of [['judgement', 3000], ['openQuestions', 2000], ['nextStep', 1000], ['reason', 2000]] as const) {
    if (typeof value[key] !== 'string' || value[key].length > max) throw new Error(`事项进展 ${key} 无效。`)
  }
  if (!value.judgement.trim() || !value.reason.trim()) throw new Error('事项必须保留当前判断与变化原因。')
  if (['researching', 'needs_evidence'].includes(value.status) && !value.nextStep.trim()) throw new Error('继续研究的事项必须有下一步。')
  return { status: value.status, judgement: value.judgement.trim(), openQuestions: value.openQuestions.trim(), nextStep: value.nextStep.trim(), reason: value.reason.trim() }
}
export interface AgentRunDetail { run: AgentRun; events: AgentEvent[]; report: AgentReport | null; research?: AgentResearch }
export interface AgentAPI {
  searchCredential(characterId: string, key?: string): Promise<{ configured: boolean }>
  get(characterId: string): Promise<AgentOverview>
  save(characterId: string, settings: AgentSettings): Promise<AgentOverview>
  run(characterId: string, topicId?: string): Promise<AgentOverview>
  createTopic(characterId: string, input: AgentTopicInput): Promise<AgentOverview>
  editTopic(characterId: string, topicId: string, revision: number, input: AgentTopicInput, reason: string): Promise<AgentOverview>
  topicStatus(characterId: string, topicId: string, revision: number, status: AgentTopicStatus, reason: string): Promise<AgentOverview>
  focusTopic(characterId: string, topicId: string): Promise<AgentOverview>
  topicDetail(characterId: string, topicId: string, cursor?: number): Promise<AgentTopicDetail>
  pause(characterId: string): Promise<AgentOverview>
  detail(characterId: string, runId: string): Promise<AgentRunDetail>
  answer(characterId: string, runId: string, answer: string): Promise<AgentOverview>
  remember(characterId: string, content: string): Promise<AgentOverview>
  forget(characterId: string, memoryId: string): Promise<AgentOverview>
  onChanged(callback: (characterId: string) => void): () => void
}
export function validateAgentSettings(raw: unknown): AgentSettings {
  if (!raw || typeof raw !== 'object') throw new Error('工作设置无效。')
  const value = raw as AgentSettings
  if (typeof value.goal !== 'string' || !value.goal.trim() || value.goal.length > 2000) throw new Error('请填写 1–2000 字的工作方向。')
  if (value.permissionLevel !== undefined && !['public', 'sources'].includes(value.permissionLevel)) throw new Error('工作权限等级无效。')
  if (!Array.isArray(value.sources) || value.sources.length > 5) throw new Error('参考资料最多 5 个网页地址，可留空。')
  if (value.permissionLevel === 'sources' && !value.sources.length) throw new Error('限制访问时，请至少添加一个允许读取的参考网页。')
  if (value.permissionLevel === 'sources' && value.searchEnabled) throw new Error('仅参考资料模式不能开启自主搜索。')
  const sources = value.sources.map(url => {
    if (typeof url !== 'string' || url.length > 2000) throw new Error('网页地址无效。')
    let parsed: URL
    try { parsed = new URL(url.trim()) } catch { throw new Error('网页地址须包含 https://。') }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('仅支持不带登录凭据的 HTTPS 网页。')
    if ([...parsed.searchParams.keys()].some(key => /^(api[_-]?key|access[_-]?token|token|password|secret|authorization|signature)$/i.test(key))) throw new Error('请使用不带密钥或访问令牌的公开网页。')
    parsed.hash = ''
    return parsed.href
  })
  if (!Number.isInteger(value.intervalMinutes) || value.intervalMinutes < 15 || value.intervalMinutes > 10080) throw new Error('工作间隔应为 15–10080 分钟。')
  if (!Number.isInteger(value.dailyCalls) || value.dailyCalls < 2 || value.dailyCalls > 48) throw new Error('每日模型调用上限应为 2–48 次。')
  if (typeof value.enabled !== 'boolean') throw new Error('启用状态无效。')
  if (value.notifyProgress !== undefined && typeof value.notifyProgress !== 'boolean') throw new Error('通知设置无效。')
  if (value.searchEnabled !== undefined && typeof value.searchEnabled !== 'boolean') throw new Error('搜索开关无效。')
  if (value.dailySearches !== undefined && (!Number.isInteger(value.dailySearches) || value.dailySearches < 1 || value.dailySearches > 24)) throw new Error('每日搜索上限应为 1–24 次。')
  return { ...(value.permissionLevel !== undefined ? { permissionLevel: value.permissionLevel } : {}), goal: value.goal.trim(), sources: [...new Set(sources)], intervalMinutes: value.intervalMinutes, dailyCalls: value.dailyCalls, enabled: value.enabled, ...(value.notifyProgress !== undefined ? { notifyProgress: value.notifyProgress } : {}), ...(value.searchEnabled !== undefined ? { searchEnabled: value.searchEnabled } : {}), ...(value.dailySearches !== undefined ? { dailySearches: value.dailySearches } : {}) }
}
export const AGENT_STATUS: Record<AgentRunStatus, string> = {
  queued: '等待执行', running: '正在工作', waiting: '等你回复', completed: '已完成', failed: '执行失败', cancelled: '已取消', interrupted: '等待恢复'
}
