import {DEFAULT_CHARACTER_ID} from '../../shared/characters'
import {sourceSnapshot,validateTaskRef,type ResultTaskRef,type ResultSourceRef} from '../../shared/result-design'
import type {AssistantRoutine,AssistantRoutineExecution} from '../../shared/assistant-routines'
import type {ResultSourcePort} from './sources'
export class AssistantResultSources implements ResultSourcePort {
  constructor(private readState:(key:string)=>string){}
  private task(ref:ResultTaskRef,signal:AbortSignal){
    signal.throwIfAborted();validateTaskRef(ref)
    if(ref.domain!=='assistant'||ref.ownerId!==DEFAULT_CHARACTER_ID)throw new Error('助手成果归属无效。')
    const item=(JSON.parse(this.readState('assistant-routines-v1')||'[]') as AssistantRoutine[]).find(t=>t.id===ref.taskId)
    if(!item)throw new Error('助手任务已删除。');return item
  }
  async version(task:ResultTaskRef,sourceId:string|undefined,signal:AbortSignal){
    const item=this.task(task,signal)
    const history=JSON.parse(this.readState(`assistant-routine-history:${task.taskId}`)||'[]') as AssistantRoutineExecution[]
    const result=history.find(e=>e.status==='completed'&&e.content?.trim()&&(!sourceId||e.id===sourceId))
    return result?.content?sourceSnapshot(task,result.id,item.title,[{id:'result',title:item.title,body:result.content,sources:[]}],[]):null
  }
  latest(task:ResultTaskRef,signal:AbortSignal){return this.version(task,undefined,signal)}
  async read(ref:ResultSourceRef,signal:AbortSignal){
    const snapshot=await this.version(ref,ref.sourceId,signal)
    if(!snapshot||snapshot.ref.contentHash!==ref.contentHash)throw new Error('助手成果已变化。')
    return snapshot
  }
  async assertCurrent(ref:ResultSourceRef,intent:'automatic'|'explicit',signal:AbortSignal){
    const task=this.task(ref,signal)
    if(!task.enabled&&!task.finishedAt&&intent==='automatic')throw new Error('助手任务已暂停。')
    const latest=await this.latest(ref,signal)
    if(latest?.ref.sourceId!==ref.sourceId||latest.ref.contentHash!==ref.contentHash)throw new Error('助手已有新的正式成果。')
  }
}
