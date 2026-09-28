export interface TaskResourceBudget { modelCalls: number; reason: string }

export function validateTaskResourceBudget(raw: unknown): TaskResourceBudget {
  const value = raw as TaskResourceBudget | undefined
  if (!value || !Number.isSafeInteger(value.modelCalls) || value.modelCalls < 1 || value.modelCalls > 10000) throw new Error('任务调用预算应为 1–10000 次。')
  if (typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 1000) throw new Error('请说明任务资源分配理由（最多 1000 字）。')
  return { modelCalls: value.modelCalls, reason: value.reason.trim() }
}
