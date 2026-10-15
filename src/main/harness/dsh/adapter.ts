import type { HarnessAdapter, HarnessInput, HarnessResult, HarnessSink } from '../contracts'
import type { HarnessStore } from '../store'
import type { DshRuntimePool, DshRuntimeLease } from './runtime'
import {dshRuntimeGroup} from './runtime'

export class DshAdapter implements HarnessAdapter {
  private leases=new Map<string,DshRuntimeLease>()
  async beforePersistentOffer(key:import('../contracts').ToolKey):Promise<void> {
    const run=this.store.get(key),lease=this.leases.get(JSON.stringify([key.requestId,key.attemptId]))
    if(!run||!lease||!await lease.flush(key))throw new Error('执行日志尚未保存，未创建确认事项。')
    this.store.markDurable(key)
  }
  constructor(private pool:Pick<DshRuntimePool,'acquire'>,private store:HarnessStore,private cancelActions?:(key:HarnessInput)=>Promise<void>) {}
  async run(input:HarnessInput,emit:HarnessSink):Promise<HarnessResult> {
    if(this.store.get(input)) return {state:'interrupted',error:'此执行已有记录，未自动重放。请重新发送消息。'}
    this.store.begin(input)
    this.store.bindRuntime(input,dshRuntimeGroup(input))
    let lease:DshRuntimeLease|undefined
    try {
      input.signal.throwIfAborted();await input.assertContext()
      lease=await this.pool.acquire(input)
      this.leases.set(JSON.stringify([input.requestId,input.attemptId]),lease)
      this.store.bindSession(input,input.attemptId)
      this.store.transition(input,'starting','running')
      const result=await lease.run(input,event=>{
        if(event.type==='prepared')this.store.bindInput(input,event.inputMessageId)
        if(event.type==='usage')this.store.recordUsage(input,event.providerRequestId,event.metadata.usage??null)
        emit(event)
      })
      if(result.state==='completed') {
        if(!await lease.flush(input))throw new Error('执行日志尚未确认保存。')
        this.store.markDurable(input)
      }
      const record=this.store.get(input)!
      if(!this.store.transition(input,record.state,result.state))throw new Error('执行状态已变化，不能发布回复。')
      return result.state==='completed'?{...result,source:{requestId:input.requestId,attemptId:input.attemptId,engine:'dsh',version:record.version,messageId:record.messageId}}:result
    } catch(error) {
      const state=input.signal.aborted?'cancelled':'failed'
      const record=this.store.get(input)!
      this.store.transition(input,record.state,state)
      return {state,error:error instanceof Error?error.message:'DSH 执行失败。'}
    } finally {
      try{if(input.signal.aborted)await this.cancelActions?.(input)}
      finally{this.leases.delete(JSON.stringify([input.requestId,input.attemptId]));await lease?.release()}
    }
  }
}
