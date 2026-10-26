import { type AgentOverview, type AgentTopic } from '../../../../shared/agents'
import { taskState } from '../../../../shared/task-state'
import type { AssistantRoutine } from '../../../../shared/assistant-routines'
import type { AssistantTaskEntry } from './useAssistantTasks'
import { calendarScheduleLabel } from '../../../../shared/calendar-schedule'

/** View data only. Execution/storage adapters do not own task UI. */
export interface ContactTaskItem {
  id: string; title: string; status: string; focused?: boolean; running?: boolean; enabled?: boolean
  createdAt?: number; updatedAt?: number; canDelete: boolean
  summary?: string; template?: boolean
  work?: AgentTopic; scheduled?: AssistantTaskEntry
}
export function routineTimesLabel(routine: Pick<AssistantRoutine, 'finishedAt' | 'cadence' | 'weekday' | 'date' | 'times' | 'monthDay' | 'intervalDays' | 'anchorDate'>): string {
  if (routine.finishedAt) return '已完成'
  return calendarScheduleLabel(routine)
}
export function contactTaskItems(data: AgentOverview, scheduled: AssistantTaskEntry[]): ContactTaskItem[] {
  return [
    ...scheduled.map(item => ({ id: item.id, title: item.title,
      status: item.execution ? ({ checking: '正在检查', generating: '正在整理', delivering: '正在投递', cancelling: '正在停止' } as const)[item.execution.phase] : item.status,
      running: Boolean(item.execution), enabled: item.routine ? item.routine.enabled && !item.routine.finishedAt : item.duty ? item.status === '已启用' : false,
      canDelete: !!item.routine, scheduled: item,
      template: !item.routine && !item.duty,
      createdAt: item.routine?.createdAt, updatedAt: item.routine?.updatedAt,
      summary: item.routine ? item.routine.finishedAt ? '已完成'
        : item.routine.enabled ? `${routineTimesLabel(item.routine)} · ${item.routine.retryAt ? '下次重试' : '下次执行'} ${new Date(item.routine.retryAt ?? item.routine.nextAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}`
        : '已暂停自动执行'
        : item.duty ? item.description : '尚未配置时间，不计入任务总数' })),
    ...data.topics.map(work => {
      const run = data.runs.find(run => run.topicId === work.id && ['queued', 'running', 'waiting', 'interrupted'].includes(run.status))
      const state = taskState(data, work)
      return { id: work.id, title: work.title, status: state.label,
        enabled: !['paused', 'completed', 'abandoned'].includes(work.status) && !data.taskSchedule?.[work.id]?.finishedAt && data.settings.enabled && Boolean(data.taskSchedule?.[work.id] || data.focusTopicId === work.id),
        focused: work.id === data.focusTopicId, running: !!run && !['paused', 'completed', 'abandoned'].includes(work.status), createdAt: work.createdAt, updatedAt: work.updatedAt, canDelete: true, work,
        summary: state.code === 'waiting' ? `待回复：${run?.question}` : state.code === 'running' ? work.nextStep || work.judgement || work.goal : state.description }
    })
  ]
}
