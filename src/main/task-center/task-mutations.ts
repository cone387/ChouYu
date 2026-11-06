import type { AgentTopicStatus } from '../../shared/agents'
import type { FeedbackMethod } from '../../shared/contact-commands'
import type { TaskRequestEffect } from '../../shared/contact-task-requests'
import type { ContactIdentity } from '../contact-agent/contracts'
import type { ContactTaskStore } from './contact-store'

export const TASK_MUTATIONS: readonly FeedbackMethod[] = ['editTaskFromChat', 'editCalendarTopic', 'assignCalendarTopic', 'topicStatus', 'deleteTopic', 'editTopic', 'continueTopic', 'answerChecked', 'assignTopic', 'reviseTopic']
export interface TaskMutationResult { topicId: string; effect: TaskRequestEffect; runId?: string; abort?: boolean; deletedRevision?: number; cleanup?: string[] }

/** Only database work. Cancellation, checkpoint cleanup and notifications happen after commit. */
export function mutateTask(store: ContactTaskStore, identity: ContactIdentity, method: FeedbackMethod, args: unknown[]): TaskMutationResult {
  const id = identity.id, topicId = String(args[0]), revision = args[1] as number
  const model = (search = true) => {
    if (!identity.config) throw new Error('请先为联系人配置可用的模型。')
    if (search && store.overview(id).settings.searchEnabled && !identity.searchKey) throw new Error('请先配置搜索密钥，或关闭自主补证据。')
  }
  switch (method) {
    case 'editTaskFromChat':
      store.editTaskFromChat(id, topicId, revision, args[2] as import('../../shared/contact-task-edit').ContactTaskEdit, args[3] as string)
      return { topicId, effect: 'requirements', abort: true }
    case 'editCalendarTopic':
      store.editCalendarTopic(id, topicId, revision, args[2], args[3] as string)
      return { topicId, effect: 'requirements', abort: true }
    case 'editTopic':
    case 'topicStatus':
      store.changeTopic(id, topicId, revision, method === 'editTopic' ? { input: args[2], reason: args[3] as string, requestLog: args[4] as string | undefined } : { status: args[2] as AgentTopicStatus, reason: args[3] as string })
      return { topicId, effect: method === 'editTopic' ? 'requirements' : 'control', abort: true }
    case 'deleteTopic': {
      store.topics.check(id, topicId, revision)
      return { topicId, effect: 'control', deletedRevision: revision, cleanup: store.deleteTopic(id, topicId, revision) }
    }
    case 'continueTopic':
      model()
      return { topicId, effect: 'assignment', runId: store.continueTopic(id, topicId, revision, String(args[2]), identity.conversation, args[3] as string | undefined) }
    case 'answerChecked': {
      store.topics.check(id, topicId, revision)
      const run = store.getRun(String(args[2]))
      if (run?.topic_id !== topicId) throw new Error('问题与事项不匹配。')
      store.answer(id, run.id, String(args[3]))
      return { topicId, effect: 'answer', runId: run.id }
    }
    case 'assignTopic': {
      model()
      const topic = store.assignTopic(id, args[0], identity.conversation, args[1] as string | undefined, args[2] as number | undefined, args[3] as import('../../shared/task-ending').TaskEndingRequest | undefined)
      return { topicId: topic.id, effect: 'assignment', runId: store.overview(id).runs.find(run => run.topicId === topic.id && ['queued', 'running', 'waiting', 'interrupted'].includes(run.status))?.id }
    }
    case 'assignCalendarTopic': {
      model()
      const topic = store.assignCalendarTopic(id, args[0], identity.conversation, args[1] as string | undefined)
      return { topicId: topic.id, effect: 'assignment' }
    }
    case 'reviseTopic': {
      model()
      const runId = store.reviseTopic(id, topicId, revision, args[2], identity.conversation, args[3] as string | undefined)
      return { topicId, effect: 'revision', runId }
    }
  }
}
