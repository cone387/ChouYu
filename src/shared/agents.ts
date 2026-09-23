export interface AgentSettings {
  goal: string
  sources: string[]
  intervalMinutes: number
  dailyCalls: number
  enabled: boolean
}
export const DEFAULT_AGENT_SETTINGS: AgentSettings = { goal: '', sources: [], intervalMinutes: 180, dailyCalls: 8, enabled: false }
export type AgentRunStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export interface AgentEvidence { url: string; title: string; text: string; capturedAt: number; hash: string }
export interface AgentRun {
  id: string; characterId: string; revision: number; status: AgentRunStatus; createdAt: number; updatedAt: number
  question: string; answer: string; summary: string; error: string
}
export interface AgentEvent { id: number; runId: string; kind: string; text: string; at: number }
export interface AgentMemory { id: string; content: string; runId: string | null; createdAt: number }
export interface AgentReport { runId: string; title: string; body: string; nextStep: string; evidence: AgentEvidence[]; createdAt: number }
export interface AgentOverview {
  settings: AgentSettings; revision: number; nextAt: number; callsToday: number
  runs: AgentRun[]; memories: AgentMemory[]; reports: AgentReport[]
}
export interface AgentRunDetail { run: AgentRun; events: AgentEvent[]; report: AgentReport | null }
export interface AgentAPI {
  get(characterId: string): Promise<AgentOverview>
  save(characterId: string, settings: AgentSettings): Promise<AgentOverview>
  run(characterId: string): Promise<AgentOverview>
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
  if (!Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > 5) throw new Error('请提供 1–5 个允许读取的网页地址。')
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
  return { goal: value.goal.trim(), sources: [...new Set(sources)], intervalMinutes: value.intervalMinutes, dailyCalls: value.dailyCalls, enabled: value.enabled }
}
export const AGENT_STATUS: Record<AgentRunStatus, string> = {
  queued: '等待执行', running: '正在工作', waiting: '等你回复', completed: '已完成', failed: '执行失败', cancelled: '已取消', interrupted: '等待恢复'
}
