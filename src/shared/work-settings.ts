import { agentUsesPlanner, type AgentOverview, type AgentSettings, type AgentTopic } from './agents'

/** Access changes invalidate the inputs captured by an unfinished round. */
export function workSettingsRequireRestart(previous: AgentSettings, next: AgentSettings): boolean {
  return previous.enabled && !next.enabled ||
    (previous.permissionLevel ?? 'public') !== (next.permissionLevel ?? 'public') ||
    Boolean(previous.searchEnabled) !== Boolean(next.searchEnabled) ||
    Boolean(previous.readContactDeliveries) !== Boolean(next.readContactDeliveries) ||
    JSON.stringify(previous.sources) !== JSON.stringify(next.sources)
}

export function workCadence(settings: AgentSettings): string {
  return settings.paceWriting ? `每 ${settings.intervalMinutes} 分钟推进一轮` : `创作连续推进；资料检查至少间隔 ${settings.intervalMinutes} 分钟`
}

export function contactWorkStatus(data: AgentOverview, keyConfigured: boolean, now = Date.now()): string {
  const { settings } = data
  if (settings.workUntil && settings.workUntil <= now) return '持续工作已到期。取消或延长截止时间，再开启自动工作。'
  if (settings.searchEnabled && !keyConfigured) return '搜索密钥缺失。配置密钥，或关闭搜索服务。'
  const run = data.runs.find(run => ['running', 'queued', 'interrupted'].includes(run.status))
  if (run) return run.status === 'running' ? '正在执行本轮工作。' : run.status === 'interrupted' ? '正在等待恢复中断的工作。' : '任务已排队，等待执行。'
  const needed = agentUsesPlanner(settings) ? 2 : 1
  if (data.callsToday + needed > settings.dailyCalls) return '今日共用额度不足下一轮。明日恢复，也可提高每日上限。'
  if (!settings.enabled) return '自动工作已关闭。手动启动或新交付的任务执行一轮后停止。'
  const topic = data.topics.find(topic => topic.id === data.focusTopicId)
  if (topic && !['planned', 'researching', 'needs_evidence'].includes(topic.status)) return '当前任务已暂停或结束。开启自动工作不会恢复已暂停的任务，请在任务中继续。'
  if (!data.topics.length) return '自动工作已开启，等待你交付任务。'
  if (data.runs.some(run => run.status === 'waiting' && run.topicId === topic?.id)) return '当前任务正在等你回复；其他已安排任务仍可继续。'
  const used = topic ? data.topicMetrics?.[topic.id]?.calls ?? 0 : 0
  if (topic?.resourceBudget && used + needed > topic.resourceBudget.modelCalls) return '当前任务累计预算不足。到本任务设置提高预算，再继续任务。'
  return data.nextAt > now ? `下次检查：${new Date(data.nextAt).toLocaleString()}。` : '自动工作已开启，等待调度。'
}

export function taskWorkStatus(data: AgentOverview, topic: AgentTopic, now = Date.now()): string {
  if (['paused', 'completed', 'abandoned'].includes(topic.status)) return '任务已暂停或结束，需要在本任务中继续；开启联系人自动工作不会恢复它。'
  const run = data.runs.find(run => run.topicId === topic.id && ['running', 'queued', 'interrupted', 'waiting'].includes(run.status))
  if (run) return run.status === 'waiting' ? '等你回复后继续。' : '本轮正在执行或等待恢复。'
  const needed = agentUsesPlanner(data.settings) ? 2 : 1
  if (topic.resourceBudget && (data.topicMetrics?.[topic.id]?.calls ?? 0) + needed > topic.resourceBudget.modelCalls) return '本任务累计预算不足，需要提高预算后继续。'
  if (data.settings.workUntil && data.settings.workUntil <= now) return '联系人自动工作已到期，需要取消或延长截止时间。'
  if (data.callsToday + needed > data.settings.dailyCalls) return '联系人今日共用额度不足，等待明日恢复或提高每日上限。'
  if (data.queuedTopicIds?.includes(topic.id)) return '任务已交付，等待联系人按顺序执行。'
  return data.settings.enabled ? data.focusTopicId === topic.id ? '自动工作已开启，按联系人规则继续推进。' : '自动工作已开启；当前优先推进其他任务，可在本任务中启动或继续。' : '自动工作已关闭，手动启动后执行一轮。'
}
