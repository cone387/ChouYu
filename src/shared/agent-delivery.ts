export interface DeliveryStage { id: string; title: string; status: 'pending' | 'active' | 'done' }
export interface DeliverySection { id: string; title: string; body: string; runId: string; sources?: { url: string; title: string; capturedAt: number }[] }
export interface DeliveryUpdate {
  completionCriteria: string
  stages: DeliveryStage[]
  summary: string
  section: Pick<DeliverySection, 'id' | 'title' | 'body'>
}
export interface AgentDelivery {
  version: number; runId: string; createdAt: number
  completionCriteria: string; stages: DeliveryStage[]; summary: string
  sections: DeliverySection[]
}
export function validateDeliveryUpdate(raw: unknown): DeliveryUpdate {
  if (!raw || typeof raw !== 'object') throw new Error('缺少成果内容。')
  const v = raw as DeliveryUpdate
  const text = (s: unknown, max: number): s is string => typeof s === 'string' && Boolean(s.trim()) && s.length <= max
  const id = (s: unknown): s is string => typeof s === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(s)
  if (!text(v.completionCriteria, 1000) || !text(v.summary, 2000)) throw new Error('成果必须有完成条件与累积摘要。')
  if (!Array.isArray(v.stages) || !v.stages.length || v.stages.length > 30 || v.stages.some(s => !s || !id(s.id) || !text(s.title, 160) || !['pending', 'active', 'done'].includes(s.status)) || new Set(v.stages.map(s => s.id)).size !== v.stages.length) throw new Error('阶段计划无效。')
  if (!v.section || !id(v.section.id) || !text(v.section.title, 160) || !text(v.section.body, 10000)) throw new Error('成果分节无效。')
  return { completionCriteria: v.completionCriteria.trim(), summary: v.summary.trim(), stages: v.stages.map(s => ({ id: s.id, title: s.title.trim(), status: s.status })), section: { id: v.section.id, title: v.section.title.trim(), body: v.section.body.trim() } }
}
export function deliveryMarkdown(title: string, value: AgentDelivery): string {
  return `# ${title}\n\n版本 ${value.version}\n\n## 完成条件\n\n${value.completionCriteria}\n\n## 阶段\n\n${value.stages.map(s => `- [${s.status === 'done' ? 'x' : ' '}] ${s.title}${s.status === 'active' ? '（进行中）' : ''}`).join('\n')}\n\n## 进展摘要\n\n${value.summary}\n\n${value.sections.map(s => `## ${s.title}\n\n${s.body}\n\n${(s.sources || []).map((source, i) => `[${i + 1}] ${source.title}: ${source.url}（读取于 ${new Date(source.capturedAt).toISOString()}）`).join('\n')}\n来源轮次：${s.runId}`).join('\n\n')}\n`
}
