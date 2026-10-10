import { sanitizeProgressUpdate } from './agent-progress'
export interface AgentSettings {
  maxConcurrentTasks?: number
  workHours?: { start: string; end: string }
  dailyTokenLimit?: number
  defaultTaskTokenLimit?: number
  readContactDeliveries?: boolean
  shareDeliveries?: boolean
  paceWriting?: boolean
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
export interface ContactDeliveryRef { characterId: string; topicId: string; version: number; sectionId: string }
export interface AgentResearchPlan { evaluation?: boolean; action: 'search' | 'read' | 'wait' | 'write' | 'discover_contacts' | 'read_contacts'; contactRefs?: ContactDeliveryRef[]; reason: string; query: string; urls: string[]; checkAfterMinutes: number; sectionId?: string; resourceBudget?: import('./agent-resources').TaskResourceBudget }
export interface AgentSearchResult { url: string; title: string }
export interface AgentSearchRecord { query: string; at: number; results: AgentSearchResult[]; error?: string }
export interface AgentResearch { contactQuery?: string; plan: AgentResearchPlan; searches: AgentSearchRecord[]; reads: { url: string; status: 'read' | 'failed'; hash?: string }[]; nextCheckAt?: number; unchanged?: boolean }
export interface AgentMessageRef { interactionId?: string; topicId: string; runId: string; kind: 'question' | 'progress'; update?: import('./agent-progress').AgentProgressUpdate }
export interface AgentNotice extends AgentMessageRef { communication?: import('./contact-communication').ContactCommunication; id: string; characterId: string; topicRevision: number; content: string; createdAt: number; purpose?: 'direction' | 'resources' | 'presentation' | 'failure' }
export interface AgentFocusRequest extends AgentMessageRef { tab: 'work' | 'history'; nonce: number }
export function sanitizeAgentMessageRef(value: unknown): AgentMessageRef | undefined {
  if (!value || typeof value !== 'object') return undefined
  const ref = value as AgentMessageRef
  if (!['progress', 'question'].includes(ref.kind) || ![ref.topicId, ref.runId].every(id => typeof id === 'string' && id.length > 0 && id.length <= 128)) return undefined
  const update = ref.kind === 'progress' ? sanitizeProgressUpdate(ref.update) : undefined
  return { ...(typeof ref.interactionId === 'string' && ref.interactionId.length > 0 && ref.interactionId.length <= 256 ? { interactionId: ref.interactionId } : {}), topicId: ref.topicId, runId: ref.runId, kind: ref.kind, ...(update ? { update } : {}) }
}
export const DEFAULT_AGENT_SETTINGS: AgentSettings = { goal: '', sources: [], intervalMinutes: 180, dailyCalls: 8, enabled: false }
export function agentUsesPlanner(settings: AgentSettings): boolean {
  return settings.readContactDeliveries === true || settings.permissionLevel !== 'sources' && (settings.searchEnabled === true || settings.sources.length === 0)
}
export type AgentRunStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export interface AgentEvidence { url: string; title: string; text: string; capturedAt: number; hash: string }
export interface AgentRun {
  revisionScope?: 'presentation'
  inputFields?: import('./agent-delivery').TaskInputField[]
  id: string; characterId: string; revision: number; status: AgentRunStatus; createdAt: number; updatedAt: number
  topicId: string | null
  question: string; answer: string; summary: string; error: string
}
export interface AgentEvent { id: number; runId: string; kind: string; text: string; at: number }
export interface AgentInteraction extends AgentEvent { kind: 'waiting' | 'answer'; pending: boolean }
export interface AgentInteractionPage { items: AgentInteraction[]; nextCursor?: number }
export interface AgentMemory { id: string; content: string; runId: string | null; createdAt: number }
export interface AgentReport { evaluations?: import('./agent-evaluation').AgentEvaluation[]; runId: string; title: string; body: string; nextStep: string; evidence: AgentEvidence[]; createdAt: number }
export interface AgentOverview {
  taskFailures?: Record<string, { failures: number; retryAt?: number }>
  providerRecovery?: { topicId: string; at: number }
  tokenUsage?: { today: number; estimated: number; tasks: Record<string, number> }
  failures?: number
  queuedTopicIds?: string[]
  topicMetrics?: Record<string, AgentTopicMetrics>
  latestActivity?: AgentEvent
  searchesToday?: number
  settings: AgentSettings; revision: number; nextAt: number; callsToday: number
  runs: AgentRun[]; memories: AgentMemory[]; reports: AgentReport[]
  topics: AgentTopic[]; focusTopicId: string | null
}
export interface AgentTopicMetrics {
  runs: number; calls: number; searches: number
  elapsedMs: number; activeRuns: number; measuredAt: number
  inputTokens: number; outputTokens: number; totalTokens: number
  inputReported: number; outputReported: number; totalReported: number
  models: string[]
  latestRun?: Pick<AgentRun, 'createdAt' | 'status'>
}
export const TOPIC_STATUS = { planned: '待开始', researching: '尚未完成', needs_evidence: '待补证据', paused: '已暂停', completed: '已结束', abandoned: '已放弃' } as const
export type AgentTopicStatus = keyof typeof TOPIC_STATUS
export interface AgentTopicInput { title: string; goal: string; constraints: string }
export interface AgentTopic extends AgentTopicInput {
  /** Delivery grouping only; does not limit research/read batches. */
  separateEvaluations?: boolean
  tokenLimit?: number
  resourceBudget?: import('./agent-resources').TaskResourceBudget
  initialPlan?: import('./agent-delivery').DeliveryPlan
  requestLog?: string
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
    if (typeof value[key] !== 'string' || value[key].length > max) throw new Error(`事项进展 ${key} 无效（${value[key] == null ? '缺失或为空值' : typeof value[key] !== 'string' ? '类型应为字符串' : `长度 ${value[key].length} 超过 ${max}`}）。`)
  }
  if (!value.judgement.trim() || !value.reason.trim()) throw new Error('事项必须保留当前判断与变化原因。')
  if (['researching', 'needs_evidence'].includes(value.status) && !value.nextStep.trim()) throw new Error('继续研究的事项必须有下一步。')
  return { status: value.status, judgement: value.judgement.trim(), openQuestions: value.openQuestions.trim(), nextStep: value.nextStep.trim(), reason: value.reason.trim() }
}
export interface AgentRunDetail { run: AgentRun; events: AgentEvent[]; report: AgentReport | null; research?: AgentResearch }
export interface AgentAPI {
  pendingInteractions(characterId: string): Promise<(import('./contact-interactions').ContactInteraction & { characterName: string })[]>
  getInteraction(characterId: string, interactionId: string): Promise<import('./contact-interactions').ContactInteraction>
  submitInteraction(characterId: string, interactionId: string, submission: import('./contact-interactions').ContactInteractionSubmission): Promise<import('./contact-interactions').ContactInteraction>
  dashboard(): Promise<AgentDashboard>
  summary(characterId: string): Promise<AgentSummary>
  continueTopic(characterId: string, topicId: string, revision: number, reason: string): Promise<AgentOverview>
  setTaskBudget(characterId: string, topicId: string, revision: number, budget: Pick<import('./agent-resources').TaskResourceBudget, 'modelCalls'>): Promise<AgentOverview>
  delivery(characterId: string, topicId: string, version?: number): Promise<import('./agent-delivery').AgentDelivery | null>
  exportDelivery(characterId: string, topicId: string, version: number, format?: 'markdown' | 'html'): Promise<boolean>
  reviseTopic(characterId: string, topicId: string, revision: number, feedback: string, sectionId?: string, scope?: 'content' | 'presentation', deliveryVersion?: number): Promise<AgentOverview>
  savePreferences(characterId: string, settings: AgentSettings, expectedRevision?: number): Promise<AgentOverview>
  searchCredential(characterId: string, key?: string): Promise<{ configured: boolean }>
  get(characterId: string): Promise<AgentOverview>
  save(characterId: string, settings: AgentSettings): Promise<AgentOverview>
  run(characterId: string, topicId?: string): Promise<AgentOverview>
  createTopic(characterId: string, input: AgentTopicInput): Promise<AgentOverview>
  assignTopic(characterId: string, description: string): Promise<AgentOverview>
  deleteTopic(characterId: string, topicId: string, revision: number): Promise<AgentOverview>
  editTopic(characterId: string, topicId: string, revision: number, input: AgentTopicInput, reason: string): Promise<AgentOverview>
  topicStatus(characterId: string, topicId: string, revision: number, status: AgentTopicStatus, reason: string): Promise<AgentOverview>
  focusTopic(characterId: string, topicId: string): Promise<AgentOverview>
  topicDetail(characterId: string, topicId: string, cursor?: number): Promise<AgentTopicDetail>
  interactions(characterId: string, topicId: string, cursor?: number): Promise<AgentInteractionPage>
  analytics(characterId: string, query: import('./agent-analytics').AnalyticsQuery): Promise<import('./agent-analytics').AgentAnalytics>
  pause(characterId: string): Promise<AgentOverview>
  detail(characterId: string, runId: string): Promise<AgentRunDetail>
  answer(characterId: string, runId: string, answer: string, inputs?: Record<string, string>): Promise<AgentOverview>
  remember(characterId: string, content: string): Promise<AgentOverview>
  forget(characterId: string, memoryId: string): Promise<AgentOverview>
  onChanged(callback: (characterId: string) => void): () => void
}
export interface AgentSummary { tasks: number; activeTasks: number; memories: number; calls: number; reported: number; tokens: number }
export type AgentActivityContext = Pick<AgentOverview, 'settings' | 'focusTopicId' | 'topics' | 'nextAt' | 'callsToday'>
export interface AgentDashboardContact extends AgentActivityContext { summary: AgentSummary; run?: AgentRun; latestActivity?: AgentEvent; lastWorkedAt?: number }
export interface AgentDashboard { contacts: Record<string, AgentDashboardContact>; events: (AgentEvent & { characterId: string; topicTitle: string })[] }
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
  if (!Number.isSafeInteger(value.dailyCalls) || value.dailyCalls < 2) throw new Error('每日模型调用上限应为不小于 2 的有效整数。')
  if (value.maxConcurrentTasks !== undefined && (!Number.isSafeInteger(value.maxConcurrentTasks) || value.maxConcurrentTasks < 1)) throw new Error('最多同时推进任务数应为不小于 1 的有效整数。')
  for (const key of ['readContactDeliveries', 'shareDeliveries', 'paceWriting'] as const) if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error('联系人成果权限或运行节奏无效。')
  if (value.workHours !== undefined && (!value.workHours || ![value.workHours.start, value.workHours.end].every(time => typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time)))) throw new Error('工作时段须为有效的开始与结束时间。')
  for (const key of ['dailyTokenLimit', 'defaultTaskTokenLimit'] as const) {
    if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || value[key]! < 1 || value[key]! > 1000000000)) throw new Error('Token 上限应为 1–10 亿的整数。')
  }
  if (typeof value.enabled !== 'boolean') throw new Error('启用状态无效。')
  if (value.notifyProgress !== undefined && typeof value.notifyProgress !== 'boolean') throw new Error('通知设置无效。')
  if (value.searchEnabled !== undefined && typeof value.searchEnabled !== 'boolean') throw new Error('搜索开关无效。')
  if (value.dailySearches !== undefined && (!Number.isInteger(value.dailySearches) || value.dailySearches < 1 || value.dailySearches > 24)) throw new Error('每日搜索上限应为 1–24 次。')
  return { ...(value.maxConcurrentTasks !== undefined ? { maxConcurrentTasks: value.maxConcurrentTasks } : {}), ...(value.workHours !== undefined ? { workHours: { start: value.workHours.start, end: value.workHours.end } } : {}), ...(value.dailyTokenLimit !== undefined ? { dailyTokenLimit: value.dailyTokenLimit } : {}), ...(value.defaultTaskTokenLimit !== undefined ? { defaultTaskTokenLimit: value.defaultTaskTokenLimit } : {}), ...(value.paceWriting !== undefined ? { paceWriting: value.paceWriting } : {}), ...(value.readContactDeliveries !== undefined ? { readContactDeliveries: value.readContactDeliveries } : {}), ...(value.shareDeliveries !== undefined ? { shareDeliveries: value.shareDeliveries } : {}), ...(value.permissionLevel !== undefined ? { permissionLevel: value.permissionLevel } : {}), goal: value.goal.trim(), sources: [...new Set(sources)], intervalMinutes: value.intervalMinutes, dailyCalls: value.dailyCalls, enabled: value.enabled, ...(value.notifyProgress !== undefined ? { notifyProgress: value.notifyProgress } : {}), ...(value.searchEnabled !== undefined ? { searchEnabled: value.searchEnabled } : {}), ...(value.dailySearches !== undefined ? { dailySearches: value.dailySearches } : {}) }
}
export const AGENT_STATUS: Record<AgentRunStatus, string> = {
  queued: '等待执行', running: '正在工作', waiting: '等你回复', completed: '已完成', failed: '执行失败', cancelled: '已取消', interrupted: '等待恢复'
}
