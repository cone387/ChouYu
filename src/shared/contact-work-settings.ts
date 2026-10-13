import { DEFAULT_AGENT_SETTINGS, validateAgentSettings, type AgentSettings } from './agents'

export interface ContactWorkSettingsPatch {
  enabled?: boolean; paceWriting?: boolean; intervalMinutes?: number; dailyCalls?: number
  dailyTokenLimit?: number; clearDailyTokenLimit?: true
  defaultTaskTokenLimit?: number; clearDefaultTaskTokenLimit?: true
  maxConcurrentTasks?: number; workStart?: string; workEnd?: string
}
export const contactWorkSettingProperties = {
  enabled: { type: 'boolean' as const, description: '用户明确启用自动推进为true，按需为false；不改变单任务暂停状态' },
  paceWriting: { type: 'boolean' as const, description: '间隔推进为true，连续推进为false；仅明确要求时填写' },
  intervalMinutes: { type: 'number' as const, description: '间隔分钟，15–10080' },
  dailyCalls: { type: 'number' as const, description: '每日调用上限，不小于2；不支持解除调用保护' },
  dailyTokenLimit: { type: 'number' as const, description: '每日Token上限，1–10亿整数' },
  clearDailyTokenLimit: { type: 'boolean' as const, description: '仅明确取消每日Token上限时填true，不与dailyTokenLimit同时填写' },
  defaultTaskTokenLimit: { type: 'number' as const, description: '以后新任务的Token上限，不影响已有任务' },
  clearDefaultTaskTokenLimit: { type: 'boolean' as const, description: '仅明确取消新任务默认Token上限时填true' },
  maxConcurrentTasks: { type: 'number' as const, description: '最多同时推进任务数，正整数' },
  workStart: { type: 'string' as const, description: '每日开始时间HH:mm，须同时提供workEnd；全天用00:00–00:00', maxLength: 5 },
  workEnd: { type: 'string' as const, description: '每日结束时间HH:mm，允许跨夜，须同时提供workStart', maxLength: 5 }
}
export function validateContactWorkSettingsPatch(raw: unknown): ContactWorkSettingsPatch {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('工作设置修改无效。')
  const entries = Object.entries(raw)
  if (!entries.length || entries.some(([key, value]) => !Object.hasOwn(contactWorkSettingProperties, key) || value === undefined || value === null)) throw new Error('工作设置修改字段无效。')
  const patch = raw as ContactWorkSettingsPatch
  for (const [clear, value] of [['clearDailyTokenLimit', 'dailyTokenLimit'], ['clearDefaultTaskTokenLimit', 'defaultTaskTokenLimit']] as const) {
    if (patch[clear] !== undefined && (patch[clear] !== true || patch[value] !== undefined)) throw new Error('解除Token上限不能同时设置新上限。')
  }
  if ((patch.workStart === undefined) !== (patch.workEnd === undefined)) throw new Error('请明确完整的工作开始与结束时间。')
  applyContactWorkSettingsPatch({ ...DEFAULT_AGENT_SETTINGS, goal: '根据用户交付的任务整理方向、研究验证并反馈进展。' }, patch)
  return { ...patch }
}
export function applyContactWorkSettingsPatch(current: AgentSettings, patch: ContactWorkSettingsPatch): AgentSettings {
  const { workStart, workEnd, clearDailyTokenLimit, clearDefaultTaskTokenLimit, ...fields } = patch
  const next = { ...current, goal: current.goal || '根据用户交付的任务整理方向、研究验证并反馈进展。', ...fields,
    ...(workStart !== undefined ? { workHours: { start: workStart, end: workEnd! } } : {}) }
  if (clearDailyTokenLimit) delete next.dailyTokenLimit
  if (clearDefaultTaskTokenLimit) delete next.defaultTaskTokenLimit
  return validateAgentSettings(next)
}
export function describeContactWorkSettingsPatch(patch: ContactWorkSettingsPatch): string {
  return [patch.enabled === undefined ? '' : `工作方式：${patch.enabled ? '自动推进' : '按需推进'}`,
    patch.paceWriting === undefined ? '' : `推进节奏：${patch.paceWriting ? '间隔推进' : '连续推进'}`,
    patch.intervalMinutes === undefined ? '' : `工作间隔：${patch.intervalMinutes}分钟`,
    patch.workStart === undefined ? '' : `每日工作时间：${patch.workStart === patch.workEnd ? '全天' : `${patch.workStart}–${patch.workEnd}`}`,
    patch.dailyCalls === undefined ? '' : `每日调用上限：${patch.dailyCalls}次`,
    patch.dailyTokenLimit === undefined ? '' : `每日Token上限：${patch.dailyTokenLimit}`,
    patch.clearDailyTokenLimit ? '每日Token上限：不限制' : '',
    patch.defaultTaskTokenLimit === undefined ? '' : `新任务默认Token上限：${patch.defaultTaskTokenLimit}`,
    patch.clearDefaultTaskTokenLimit ? '新任务默认Token上限：不限制' : '',
    patch.maxConcurrentTasks === undefined ? '' : `最多同时推进：${patch.maxConcurrentTasks}项任务`
  ].filter(Boolean).join('；')
}
