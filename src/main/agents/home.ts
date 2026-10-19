import type { ContactTaskStore } from '../task-center/contact-store'
import type { ContactHomeData } from '../../shared/contact-home'
import { taskState } from '../../shared/task-state'
export function contactHome(store: ContactTaskStore, owner: string): ContactHomeData {
  if (!store.profile(owner)) throw new Error('联系人工作记录不存在。')
  const data = store.overview(owner), measuredAt = Date.now()
  return { pending: store.decisions.pending(owner), recentDeliveries: store.portfolio.list(owner, { sort: 'updated' }).items.slice(0, 5),
    tasks: data.topics.map(topic => ({ topic, state: taskState(data, topic, measuredAt), running: data.runs.some(run => run.topicId === topic.id && run.status === 'running') && !['paused', 'completed', 'abandoned'].includes(topic.status) })), summary: store.summary(owner), measuredAt }
}
