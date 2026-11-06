import { DEFAULT_CHARACTER_ID } from '../../shared/characters'
import { sourceSnapshot, type ResultSourceSnapshot } from '../../shared/result-design'
import type { AssistantRoutine, AssistantRoutineExecution } from '../../shared/assistant-routines'

export const RESULT_SOURCE_OUTBOX = 'result-source-outbox-v1'
export type ResultSourceEvent = { snapshot: ResultSourceSnapshot; enabled: boolean; revision: number }
export function routineSourceEvent(routines: string, taskId: string, history: string): ResultSourceEvent | null {
  const task = (JSON.parse(routines) as AssistantRoutine[]).find(t => t.id === taskId)
  const result = (JSON.parse(history) as AssistantRoutineExecution[]).find(e => e.status === 'completed' && e.content?.trim())
  if (!task || !result?.content) return null
  return {snapshot:sourceSnapshot({domain:'assistant',ownerId:DEFAULT_CHARACTER_ID,taskId},result.id,task.title,
    [{id:'result',title:task.title,body:result.content,sources:[]}],[]),enabled:task.enabled,revision:task.revision}
}
/** Durable cross-database delivery. A failed read/accept never acknowledges an event. */
export class ResultSourceEvents {
  private draining?: Promise<void>
  constructor(private deps: {read():string;write(value:string):void;accept(event:ResultSourceEvent):Promise<void>}) {}
  drain(): Promise<void> {
    if (this.draining) return this.draining
    const run = this.deliver(); this.draining = run
    void run.finally(() => { if (this.draining === run) this.draining = undefined }).catch(() => {})
    return run
  }
  private async deliver() {
    const events = JSON.parse(this.deps.read() || '{}') as Record<string,ResultSourceEvent>
    const errors:unknown[]=[]
    for (const [id,event] of Object.entries(events)) {
      try{await this.deps.accept(event)}catch(error){errors.push(error);continue}
      const current = JSON.parse(this.deps.read() || '{}') as Record<string,ResultSourceEvent>
      if (JSON.stringify(current[id]) === JSON.stringify(event)) { delete current[id]; this.deps.write(JSON.stringify(current)) }
    }
    if(errors.length)throw errors[0]
  }
}
