import { agentUsesPlanner, TOPIC_STATUS, type AgentOverview, type AgentTopic } from './agents'
import { withinWorkHours } from './work-settings'

export interface TaskState { code: string; label: string; description: string }
/** Shared projection of lifecycle, actual round and scheduling; never infer completion from a round. */
export function taskState(data: AgentOverview, topic: AgentTopic, now = Date.now()): TaskState {
  const state = (code: string, label: string, description: string): TaskState => ({ code, label, description })
  if (['paused', 'completed', 'abandoned'].includes(topic.status)) return state(topic.status, TOPIC_STATUS[topic.status], topic.reason || '已有成果保留，不自动继续。')
  const run = data.runs.find(r => r.topicId === topic.id)
  const status = run?.status ?? data.topicMetrics?.[topic.id]?.latestRun?.status
  if (status === 'running') return state('running', '正在推进', '正在执行本轮工作；本轮交付不代表整个任务结束。')
  if (status === 'waiting') return state('waiting', '等你回复', run?.question || '需要你的回复才能继续。')
  const settings = data.settings
  const needed = data.taskResources?.[topic.id]?.callsNeeded ?? (agentUsesPlanner(settings) ? 2 : 1) + (data.queuedTopicIds?.includes(topic.id) ? 1 : 0)
  const tokensNeeded = data.taskResources?.[topic.id]?.tokensNeeded ?? 1
  if (topic.tokenLimit && (data.tokenUsage?.tasks[topic.id] ?? 0) + tokensNeeded > topic.tokenLimit || topic.resourceBudget && (data.topicMetrics?.[topic.id]?.calls ?? 0) + needed > topic.resourceBudget.modelCalls)
    return state('task-budget', '等待调整额度', '本任务累计额度不足，已有成果保留。')
  if (settings.dailyCalls < needed || settings.dailyTokenLimit && settings.dailyTokenLimit < tokensNeeded)
    return state('daily-limit', '等待调整额度', '联系人每日上限不足本次工作所需额度，次日也无法执行，需要提高上限。')
  if (settings.dailyTokenLimit && (data.tokenUsage?.today ?? 0) + tokensNeeded > settings.dailyTokenLimit || data.callsToday + needed > settings.dailyCalls)
    return state('daily-budget', '等待额度恢复', '联系人今日共用额度不足，次日恢复或调整额度后继续。')
  const failure = data.taskFailures?.[topic.id]
  if (failure?.retryAt !== undefined) return state('retry', '等待重试', `最早 ${new Date(failure.retryAt).toLocaleString()} 自动尝试；仍受工作时间和额度限制。`)
  if (failure?.failures || status === 'failed') return state('failed', '推进受阻', '本轮执行失败，请查看对应记录；已有成果保留。')
  if (status === 'interrupted') return state('interrupted', '等待恢复', run?.error || '上轮工作被中断，等待恢复。')
  if (status === 'queued' || data.queuedTopicIds?.includes(topic.id)) return state('queued', '排队中', '等待可用执行名额；排队不代表整个任务已停止。')
  if (!settings.enabled) return state('manual', '按需推进', '自动工作未开启，手动启动后执行一轮。')
  const schedule = data.taskSchedule?.[topic.id]
  if (!schedule && data.focusTopicId !== topic.id) return state('unscheduled', '待安排推进', '此任务当前未安排自动推进，已有成果保留。')
  if (!withinWorkHours(settings, now)) return state('outside-hours', '等待工作时段', `将在工作时段 ${settings.workHours!.start}–${settings.workHours!.end} 内按设置推进。`)
  if (schedule?.waitingForUpdates) return state('updates', '等待新内容', '持续任务保持启用；有新资料或新成果时再推进，不重复生产或评审。')
  const nextAt = schedule?.nextAt ?? data.nextAt
  if (nextAt > now) return state('scheduled', '等待下一轮', `下次检查不早于 ${new Date(nextAt).toLocaleString()}；仍受额度和可用名额限制。`)
  return state('ready', '等待调度', '自动推进已安排，等待调度和可用名额；上轮交付不代表任务结束。')
}
