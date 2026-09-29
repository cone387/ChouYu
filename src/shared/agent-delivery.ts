export interface DeliveryStage { id: string; title: string; status: 'pending' | 'active' | 'done' }
export interface TaskInputField { id: string; label: string; value: string; required: boolean; hint?: string; options?: string[] }
export interface DeliveryPresentation { title: string; html: string; css: string; script: string }
export interface DeliveryPlan { completionCriteria: string; stages: DeliveryStage[]; inputs?: TaskInputField[] }
export function validateTaskInputs(raw: unknown): TaskInputField[] {
  if (!Array.isArray(raw) || raw.length > 12) throw new Error('任务需求最多包含 12 项。')
  const result = raw.map(field => {
    if (!field || typeof field.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(field.id) || typeof field.label !== 'string' || !field.label.trim() || field.label.length > 80 || typeof field.value !== 'string' || field.value.length > 1000 || typeof field.required !== 'boolean') throw new Error('任务需求字段无效。')
    if (field.hint !== undefined && (typeof field.hint !== 'string' || field.hint.length > 200)) throw new Error('任务需求说明无效。')
    if (field.options !== undefined && (!Array.isArray(field.options) || !field.options.length || field.options.length > 8 || field.options.some((s: unknown) => typeof s !== 'string' || !s.trim() || s.length > 100))) throw new Error('任务需求选项无效。')
    return { id: field.id, label: field.label.trim(), value: field.value.trim(), required: field.required, ...(field.hint ? { hint: field.hint } : {}), ...(field.options ? { options: [...new Set<string>(field.options)] } : {}) }
  })
  if (new Set(result.map(f => f.id)).size !== result.length || JSON.stringify(result).length > 8000) throw new Error('任务需求重复或过长。')
  return result
}
export function validatePresentation(raw: unknown): DeliveryPresentation {
  const value = raw as DeliveryPresentation
  for (const [key, max] of [['title', 120], ['html', 12000], ['css', 12000], ['script', 16000]] as const) {
    if (!value || typeof value[key] !== 'string' || value[key].length > max || key === 'title' && !value[key].trim()) throw new Error('成果展示代码无效或过长。')
  }
  return { title: value.title.trim(), html: value.html, css: value.css, script: value.script }
}
export function validateDeliveryPlan(raw: unknown): DeliveryPlan {
  const plan = raw as DeliveryPlan | undefined
  if (!plan || typeof plan.completionCriteria !== 'string' || !plan.completionCriteria.trim() || plan.completionCriteria.length > 1000) throw new Error('阶段计划必须有完成条件。')
  if (!Array.isArray(plan.stages) || !plan.stages.length || plan.stages.length > 30 || plan.stages.some(s => !s || typeof s.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(s.id) || typeof s.title !== 'string' || !s.title.trim() || s.title.length > 160 || !['pending', 'active', 'done'].includes(s.status)) || new Set(plan.stages.map(s => s.id)).size !== plan.stages.length) throw new Error('阶段计划无效。')
  return { completionCriteria: plan.completionCriteria.trim(), stages: plan.stages.map(s => ({ id: s.id, title: s.title.trim(), status: s.status })), ...(plan.inputs === undefined ? {} : { inputs: validateTaskInputs(plan.inputs) }) }
}
export interface DeliverySection { id: string; title: string; body: string; runId: string; sources?: { url: string; title: string; capturedAt: number }[] }
export interface DeliveryUpdate {
  completionCriteria: string
  stages: DeliveryStage[]
  summary: string
  section?: Pick<DeliverySection, 'id' | 'title' | 'body'>
  inputs?: TaskInputField[]
  presentation?: DeliveryPresentation | null
}
export interface AgentDelivery {
  version: number; runId: string; createdAt: number
  completionCriteria: string; stages: DeliveryStage[]; summary: string
  sections: DeliverySection[]
  inputs?: TaskInputField[]
  presentation?: DeliveryPresentation
}
export function validateDeliveryUpdate(raw: unknown): DeliveryUpdate {
  if (!raw || typeof raw !== 'object') throw new Error('缺少成果内容。')
  const v = raw as DeliveryUpdate
  const text = (s: unknown, max: number): s is string => typeof s === 'string' && Boolean(s.trim()) && s.length <= max
  const id = (s: unknown): s is string => typeof s === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(s)
  if (!text(v.completionCriteria, 1000) || !text(v.summary, 2000)) throw new Error('成果必须有完成条件与累积摘要。')
  if (!Array.isArray(v.stages) || !v.stages.length || v.stages.length > 30 || v.stages.some(s => !s || !id(s.id) || !text(s.title, 160) || !['pending', 'active', 'done'].includes(s.status)) || new Set(v.stages.map(s => s.id)).size !== v.stages.length) throw new Error('阶段计划无效。')
  if (v.section !== undefined && (!v.section || !id(v.section.id) || !text(v.section.title, 160) || !text(v.section.body, 10000))) throw new Error('成果分节无效。')
  if (!v.section && v.presentation === undefined && v.inputs === undefined) throw new Error('缺少成果正文或展示更新。')
  return { completionCriteria: v.completionCriteria.trim(), summary: v.summary.trim(), stages: v.stages.map(s => ({ id: s.id, title: s.title.trim(), status: s.status })), ...(v.section ? { section: { id: v.section.id, title: v.section.title.trim(), body: v.section.body.trim() } } : {}), ...(v.inputs === undefined ? {} : { inputs: validateTaskInputs(v.inputs) }), ...(v.presentation === undefined ? {} : { presentation: v.presentation === null ? null : validatePresentation(v.presentation) }) }
}
export function deliveryMarkdown(title: string, value: AgentDelivery): string {
  return `# ${title}\n\n版本 ${value.version}\n\n## 完成条件\n\n${value.completionCriteria}\n\n## 阶段\n\n${value.stages.map(s => `- [${s.status === 'done' ? 'x' : ' '}] ${s.title}${s.status === 'active' ? '（进行中）' : ''}`).join('\n')}\n\n## 进展摘要\n\n${value.summary}\n\n${value.sections.map(s => `## ${s.title}\n\n${s.body}\n\n${(s.sources || []).map((source, i) => `[${i + 1}] ${source.title}: ${source.url}（读取于 ${new Date(source.capturedAt).toISOString()}）`).join('\n')}\n来源轮次：${s.runId}`).join('\n\n')}\n`
}
