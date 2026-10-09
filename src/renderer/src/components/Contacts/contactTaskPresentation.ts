import { AGENT_STATUS, TOPIC_STATUS, type AgentOverview, type AgentTopic } from '../../../../shared/agents'
import type { AssistantRoutine } from '../../../../shared/assistant-routines'
import type { AssistantTaskEntry } from './useAssistantTasks'

/** View data only. Execution/storage adapters do not own task UI. */
export interface ContactTaskItem {
  id: string; title: string; status: string; focused?: boolean; running?: boolean
  createdAt?: number; updatedAt?: number; canDelete: boolean
  summary?: string; template?: boolean
  work?: AgentTopic; scheduled?: AssistantTaskEntry
}
export function routineTimesLabel(routine: Pick<AssistantRoutine, 'finishedAt' | 'cadence' | 'weekday' | 'date' | 'times'>): string {
  if (routine.finishedAt) return '已完成'
  const times = routine.times.join('、')
  if (routine.cadence === 'once') return `${routine.date} ${times}（一次性）`
  const cadence = routine.cadence === 'daily' ? '每天' : routine.cadence === 'weekdays' ? '工作日' : `每周${'日一二三四五六'[routine.weekday ?? 0]}`
  return `${cadence} ${times}`
}
export function contactTaskItems(data: AgentOverview, scheduled: AssistantTaskEntry[]): ContactTaskItem[] {
  return [
    ...scheduled.map(item => ({ id: item.id, title: item.title, status: item.status, canDelete: !!item.routine, scheduled: item,
      template: !item.routine && !item.duty,
      createdAt: item.routine?.createdAt, updatedAt: item.routine?.updatedAt,
      summary: item.routine ? item.routine.finishedAt ? '已完成'
        : item.routine.enabled ? `${routineTimesLabel(item.routine)} · ${item.routine.retryAt ? '下次重试' : '下次执行'} ${new Date(item.routine.retryAt ?? item.routine.nextAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}`
        : '已暂停自动执行'
        : item.duty ? item.description : '尚未配置时间，不计入任务总数' })),
    ...data.topics.map(work => {
      const run = data.runs.find(run => run.topicId === work.id && ['queued', 'running', 'waiting', 'interrupted'].includes(run.status))
      return { id: work.id, title: work.title, status: data.queuedTopicIds?.includes(work.id) ? '排队中' : run ? AGENT_STATUS[run.status] : TOPIC_STATUS[work.status],
        focused: work.id === data.focusTopicId, running: !!run, createdAt: work.createdAt, updatedAt: work.updatedAt, canDelete: true, work,
        summary: run?.status === 'waiting' ? `待回复：${run.question}` : work.nextStep || work.judgement || work.goal }
    })
  ]
}
