import { sourceSnapshot, validateSourceRef, validateTaskRef, type ResultSourceRef, type ResultSourceSnapshot, type ResultTaskRef } from '../../shared/result-design'
import type { AgentDelivery } from '../../shared/agent-delivery'
import type { ContactTaskStore } from '../task-center/contact-store'

export interface ResultSourcePort {
  assertAvailable?(ref:ResultSourceRef,intent:'automatic'|'explicit',signal:AbortSignal):Promise<void>
  version?(task:ResultTaskRef,sourceId:string,signal:AbortSignal):Promise<ResultSourceSnapshot|null>
  read(ref: ResultSourceRef, signal: AbortSignal): Promise<ResultSourceSnapshot>
  latest(task: ResultTaskRef, signal: AbortSignal): Promise<ResultSourceSnapshot | null>
  assertCurrent(ref: ResultSourceRef, intent: 'automatic'|'explicit', signal: AbortSignal): Promise<void>
}
export function contactSnapshot(ownerId: string, taskId: string, title: string, delivery: AgentDelivery) {
  return sourceSnapshot({domain:'contact',ownerId,taskId},String(delivery.version),title,
    delivery.sections.map(s => ({id:s.id,title:s.title,body:s.body,sources:s.sources ?? []})),delivery.fileIds ?? [])
}
/** Always rechecks ownership against the authoritative task, including historical reads. */
export class ContactResultSources implements ResultSourcePort {
  constructor(private store: ContactTaskStore) {}
  private topic(task: ResultTaskRef, signal: AbortSignal) {
    signal.throwIfAborted(); validateTaskRef(task)
    if (task.domain !== 'contact') throw new Error('成果来源域不匹配。')
    return this.store.topics.get(task.ownerId,task.taskId)
  }
  async latest(task: ResultTaskRef, signal: AbortSignal) {
    const topic = this.topic(task,signal), delivery = this.store.deliveries.get(task.taskId)
    return delivery?.sections.length ? contactSnapshot(task.ownerId,task.taskId,topic.title,delivery) : null
  }
  async version(task:ResultTaskRef,sourceId:string,signal:AbortSignal){
    const topic=this.topic(task,signal)
    if(!/^[1-9]\d*$/.test(sourceId))throw new Error('成果版本无效。')
    const delivery=this.store.deliveries.get(task.taskId,Number(sourceId))
    return delivery?.sections.length?contactSnapshot(task.ownerId,task.taskId,topic.title,delivery):null
  }
  async read(ref: ResultSourceRef, signal: AbortSignal) {
    validateSourceRef(ref); const topic = this.topic(ref,signal)
    if (!/^[1-9]\d*$/.test(ref.sourceId)) throw new Error('成果版本无效。')
    const delivery = this.store.deliveries.get(ref.taskId,Number(ref.sourceId))
    if (!delivery) throw new Error('成果版本不存在。')
    // A saved snapshot retains its original title after the task is renamed.
    let saved: ResultSourceSnapshot | undefined
    try { saved = this.store.designs.readSource(ref) } catch { /* First access to a formal version. */ }
    const snapshot = contactSnapshot(ref.ownerId,ref.taskId,saved?.title ?? topic.title,delivery)
    if (snapshot.ref.contentHash !== ref.contentHash) throw new Error('成果内容已变化。')
    return snapshot
  }
  async assertAvailable(ref: ResultSourceRef, intent: 'automatic'|'explicit', signal: AbortSignal) {
    const topic = this.topic(ref,signal)
    if(this.store.recovery.identity(ref.ownerId)&&!this.store.recovery.allowed(ref.ownerId,ref.taskId))throw new Error('成果任务尚未完成恢复核对。')
    if (topic.status === 'abandoned') throw new Error('任务已放弃。')
    if (topic.status === 'paused' && intent === 'automatic') throw new Error('任务已暂停，自动设计等待恢复。')
  }
  async assertCurrent(ref: ResultSourceRef, intent: 'automatic'|'explicit', signal: AbortSignal) {
    await this.assertAvailable(ref,intent,signal)
    const latest = await this.latest(ref,signal)
    if (!latest || latest.ref.sourceId !== ref.sourceId || latest.ref.contentHash !== ref.contentHash) throw new Error('已有新的正式成果。')
  }
}
