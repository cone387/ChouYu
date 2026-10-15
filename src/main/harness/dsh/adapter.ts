import type { HarnessAdapter, HarnessInput, HarnessResult, HarnessSink } from '../contracts'
import type { HarnessStore } from '../store'
import type { DshRuntimePool, DshRuntimeLease } from './runtime'

export class DshAdapter implements HarnessAdapter {
  constructor(private pool:Pick<DshRuntimePool,'acquire'>,private store:HarnessStore) {}
  async run(input:HarnessInput,emit:HarnessSink):Promise<HarnessResult> {
    if(this.store.get(input)) return {state:'interrupted',error:'此执行已有记录，未自动重放。请重新发送消息。'}
    this.store.begin(input)
    let lease:DshRuntimeLease|undefined
    try {
      input.signal.throwIfAborted();await input.assertContext()
      lease=await this.pool.acquire(input)
      this.store.bindSession(input,input.attemptId)
      this.store.transition(input,'starting','running')
      const result=await lease.run(input,emit)
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
    } finally {lease?.release()}
  }
}
