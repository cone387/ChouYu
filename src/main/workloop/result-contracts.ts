import { validateTaskResourceBudget, type TaskResourceBudget } from '../../shared/agent-resources'
import { validateTopicProgress, type AgentTopicProgress } from '../../shared/agents'
import { calculateEvaluations, evaluationMarkdown, evaluationSummary, type AgentEvaluation } from '../../shared/agent-evaluation'
import { validateDeliveryUpdate, validateDeliveryPlan, type DeliveryPlan, type DeliveryUpdate } from '../../shared/agent-delivery'
import { researchPlanValue } from '../agents/research'
import { AgentOutputFormatError } from '../agents/model-output'
/** Pure persisted-result contracts. Graph node names and checkpoint topology remain in workflow.ts. */
export type Draft = { evaluations?: AgentEvaluation[]; resourceBudget?: TaskResourceBudget; title: string; body: string; nextStep: string; memories: string[]; question: string; progress?: AgentTopicProgress; delivery?: DeliveryUpdate }
export type Brief = { title: string; nextStep: string; question: string; plan: DeliveryPlan; resourceBudget?: TaskResourceBudget }
export function parseBrief(raw: string, budgetAllocated = false): Brief {
  const value = researchPlanValue(raw)
  for (const [key, max] of [['title', 160], ['nextStep', 1000], ['question', 1000]] as const) {
    if (!value || typeof value[key] !== 'string' || value[key].length > max || key !== 'question' && !value[key].trim()) throw new Error('任务方向格式无效，请重试。')
  }
  const plan = validateDeliveryPlan(value.plan)
  const missing = plan.inputs?.filter(field => field.required && !field.value) ?? []
  if (missing.length && !value.question.trim()) value.question = `请补充：${missing.map(field => field.label).join('、')}`
  if (plan.stages.some(stage => stage.status !== 'pending')) throw new Error('接单时的阶段尚未执行，不能标为进行中或完成。')
  return { title: value.title.trim(), nextStep: value.nextStep.trim(), question: value.question.trim(), plan, ...(!budgetAllocated && value.resourceBudget ? { resourceBudget: validateTaskResourceBudget(value.resourceBudget) } : {}) }
}
export function parseDraft(raw: string, evidenceCount?: number, evaluationRequired = false, budgetAllocated = false): Draft {
  let value: Record<string, unknown>
  try { value = researchPlanValue(raw); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error() } catch { throw new AgentOutputFormatError(`模型未返回有效的结构化成果：需要完整、唯一的 JSON 对象（${raw.length} 字符），本轮未写入记忆。`) }
  const optionalText = (v: unknown) => v == null ? '' : Array.isArray(v) && v.every(item => typeof item === 'string') ? v.join('\n') : v
  value.question = optionalText(value.question)
  if (value.progress && typeof value.progress === 'object' && !Array.isArray(value.progress)) {
    value.progress = { ...value.progress, openQuestions: optionalText((value.progress as Record<string, unknown>).openQuestions) }
  }
  // Task progress owns continuation. The report field is a compatibility alias,
  // not a second independent requirement (nor a product's validation advice).
  const progress = value.progress === undefined ? undefined : validateTopicProgress(value.progress)
  if (progress) value.nextStep = progress.nextStep
  if (value.title == null && value.delivery && typeof value.delivery === 'object') value.title = (value.delivery as DeliveryUpdate).section?.title
  if (evaluationRequired && !value?.evaluations) throw new Error('本轮计划要求评分，但未提供结构化 evaluations，不能保存未经计算校验的分数。')
  const evaluations = value?.evaluations === undefined ? undefined : calculateEvaluations(value.evaluations, evidenceCount)
  if (evaluations) {
    value.body = evaluationSummary(evaluations)
    if (value.delivery && typeof value.delivery === 'object') {
      const delivery = value.delivery as DeliveryUpdate
      if (!delivery.section) throw new Error('评分成果必须包含正文。')
      value.delivery = { ...delivery, section: { ...delivery.section, body: evaluationMarkdown(evaluations) } }
    } else value.body = evaluationMarkdown(evaluations)
  }
  const delivery = value.delivery === undefined ? undefined : validateDeliveryUpdate(value.delivery)
  if (value.body == null && delivery?.section) value.body = delivery.section.body
  const field = (key: string, max: number, required = false) => { const text = value && value[key]; if (typeof text !== 'string' || text.length > max || required && !text.trim()) throw new Error(`成果字段 ${key} 无效（${text == null ? '缺失或为空值' : typeof text !== 'string' ? '类型应为字符串' : text.length > max ? `长度 ${text.length} 超过 ${max}` : '不得为空字符串'}）。`); return text.trim() }
  return { evaluations, resourceBudget: budgetAllocated || value.resourceBudget === undefined ? undefined : validateTaskResourceBudget(value.resourceBudget), title: field('title', 160, true), body: field('body', 10000, true), nextStep: field('nextStep', 1000), question: field('question', 1000), progress, delivery, memories: Array.isArray(value.memories) ? value.memories.filter((m): m is string => typeof m === 'string' && m.length > 0 && m.length <= 2000).slice(0, 3) : [] }
}
