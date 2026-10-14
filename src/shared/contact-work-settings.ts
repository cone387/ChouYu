import { DEFAULT_AGENT_SETTINGS, validateAgentSettings, type AgentSettings } from './agents'

export interface ContactWorkSettingsPatch {
  goal?: string; notifyProgress?: boolean; toolPermissionMode?: AgentSettings['toolPermissionMode']
  permissionLevel?: AgentSettings['permissionLevel']; sources?: string[]
  searchEnabled?: boolean; dailySearches?: number; shareDeliveries?: boolean; readContactDeliveries?: boolean
  enabled?: boolean; paceWriting?: boolean; intervalMinutes?: number; dailyCalls?: number
  dailyTokenLimit?: number; clearDailyTokenLimit?: true
  defaultTaskTokenLimit?: number; clearDefaultTaskTokenLimit?: true
  maxConcurrentTasks?: number; workStart?: string; workEnd?: string
}
export const contactWorkSettingProperties = {
  goal: { type: 'string' as const, description: '联系人长期工作方向/规则，保留未撤销要求；不用于修改角色人设或单个任务', maxLength: 2000 },
  notifyProgress: { type: 'boolean' as const, description: '是否将工作进展发送到聊天；不影响已发消息的未读提示' },
  toolPermissionMode: { type: 'string' as const, enum: ['inherit', 'confirm', 'auto', 'full'], description: '工具确认：inherit沿用系统、confirm逐次询问、auto读取自动修改前确认、full已授权工具自动；不打开已关闭工具、不批准现有待确认请求' },
  permissionLevel: { type: 'string' as const, enum: ['public', 'sources'], description: '公开网页或仅指定网页；限制范围需有sources并关闭搜索，不能只写入文字规则' },
  sources: { type: 'array' as const, items: { type: 'string' as const, maxLength: 2000 }, maxItems: 5, description: '完整参考/允许网页列表，最多5个无凭据HTTPS地址；保留未撤销网页' },
  searchEnabled: { type: 'boolean' as const, description: '是否搜索新网页；开启需要已有搜索密钥且网页权限为public' },
  dailySearches: { type: 'number' as const, description: '每日搜索上限，1–24整数' },
  shareDeliveries: { type: 'boolean' as const, description: '共享自己的正式任务成果；不共享私聊或记忆' },
  readContactDeliveries: { type: 'boolean' as const, description: '允许读取其他联系人已共享的正式成果；不能修改其他联系人' },
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
  // Validate field shapes here; dependencies on omitted fields are checked against
  // the actual saved settings by applyContactWorkSettingsPatch before any write.
  applyContactWorkSettingsPatch({ ...DEFAULT_AGENT_SETTINGS, sources: ['https://example.com/'], goal: '根据用户交付的任务整理方向、研究验证并反馈进展。' }, patch)
  return { ...patch, ...(patch.sources === undefined ? {} : { sources: [...patch.sources] }) }
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
  const policy = { inherit: '沿用系统设置', confirm: '需要确认的操作逐次询问', auto: '读取自动，修改前确认', full: '已授权工具自动执行' }
  return [patch.goal === undefined ? '' : `工作方向：${patch.goal}`,
    patch.notifyProgress === undefined ? '' : `工作进展消息：${patch.notifyProgress ? '开启' : '关闭'}`,
    patch.toolPermissionMode === undefined ? '' : `工具执行确认：${policy[patch.toolPermissionMode]}`,
    patch.permissionLevel === undefined ? '' : `网页访问：${patch.permissionLevel === 'sources' ? '仅指定网页' : '公开网页'}`,
    patch.sources === undefined ? '' : `网页列表：${patch.sources.length ? patch.sources.join('、') : '已清空'}`,
    patch.searchEnabled === undefined ? '' : `搜索新网页：${patch.searchEnabled ? '开启' : '关闭'}`,
    patch.dailySearches === undefined ? '' : `每日搜索上限：${patch.dailySearches}次`,
    patch.shareDeliveries === undefined ? '' : `共享自己的成果：${patch.shareDeliveries ? '开启' : '关闭'}`,
    patch.readContactDeliveries === undefined ? '' : `读取共享成果：${patch.readContactDeliveries ? '开启' : '关闭'}`,
    patch.enabled === undefined ? '' : `工作方式：${patch.enabled ? '自动推进' : '按需推进'}`,
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
