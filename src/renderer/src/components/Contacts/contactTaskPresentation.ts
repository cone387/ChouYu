import { AGENT_STATUS, TOPIC_STATUS, type AgentOverview, type AgentTopic } from '../../../../shared/agents'
import type { AssistantTaskEntry } from './useAssistantTasks'

/** View data only. Execution/storage adapters do not own task UI. */
export interface ContactTaskItem {
  id: string; title: string; status: string; focused?: boolean; running?: boolean
  createdAt?: number; updatedAt?: number; canDelete: boolean
  work?: AgentTopic; scheduled?: AssistantTaskEntry
}
export function contactTaskItems(data: AgentOverview, scheduled: AssistantTaskEntry[]): ContactTaskItem[] {
  return [
    ...scheduled.map(item => ({ id: item.id, title: item.title, status: item.status, canDelete: !!item.routine, scheduled: item })),
    ...data.topics.map(work => {
      const run = data.runs.find(run => run.topicId === work.id && ['queued', 'running', 'waiting', 'interrupted'].includes(run.status))
      return { id: work.id, title: work.title, status: data.queuedTopicIds?.includes(work.id) ? '排队中' : run ? AGENT_STATUS[run.status] : TOPIC_STATUS[work.status],
        focused: work.id === data.focusTopicId, running: !!run, createdAt: work.createdAt, updatedAt: work.updatedAt, canDelete: true, work }
    })
  ]
}
