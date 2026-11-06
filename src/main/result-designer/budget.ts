import { randomUUID } from 'node:crypto'
import type { ContactTaskStore } from '../task-center/contact-store'
import type { AIResponseMetadata } from '../../shared/ai-usage'
import { RESULT_DESIGNER_CHARACTER_ID } from '../../shared/result-design'

export function createDesignRun(store: ContactTaskStore): string {
  const id=randomUUID(), profile=store.profile(RESULT_DESIGNER_CHARACTER_ID)!, now=Date.now()
  store.db.prepare(`INSERT INTO runs(id,character_id,revision,status,created_at,updated_at,input,topic_id) VALUES(?,?,?,'running',?,?,?,NULL)`)
    .run(id,RESULT_DESIGNER_CHARACTER_ID,profile.revision,now,now,JSON.stringify({executionKind:'result-design',settings:JSON.parse(profile.settings)}))
  return id
}
/** Uses the existing call and token ledgers; cancellation never refunds a provider request. */
export class DesignBudget {
  private active?: {key:string;callId:number}
  constructor(private store: ContactTaskStore,private runId:string,private limit?:number,private scope=runId) {}
  reserve(serializedInput:string,outputLimit:number) {
    if(this.active) throw new Error('上次模型调用尚未结算。')
    // Count images conservatively without treating base64 bytes as text tokens.
    const input=serializedInput.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=]+/g,' '.repeat(16384))
    const used=(this.store.db.prepare('SELECT COALESCE(SUM(tokens),0) AS n FROM token_ledger WHERE topic_id=? AND character_id=?')
      .get(`design:${this.scope}`,RESULT_DESIGNER_CHARACTER_ID) as {n:number}).n
    const left=(this.limit??Infinity)-used-Buffer.byteLength(input,'utf8')-512
    if(left<Math.min(512,outputLimit)) throw new Error('本次展示设计 Token 额度不足。')
    return this.store.db.transaction(()=>{
      this.store.charge(this.runId)
      const callId=this.store.latestCallId(this.runId)!
      const reservation=this.store.tokens.reserve(this.runId,callId,RESULT_DESIGNER_CHARACTER_ID,`design:${this.scope}`,input,Math.min(outputLimit,left))
      if('error' in reservation) throw new Error(reservation.error)
      this.active={key:reservation.key!,callId}
      return {key:reservation.key!,maxOutputTokens:reservation.maxOutputTokens!}
    })()
  }
  settle(metadata:AIResponseMetadata) {
    if(!this.active)return
    this.store.recordCallMetadata(this.active.callId,metadata)
    this.store.tokens.settle(this.active.key,metadata)
    this.active=undefined
  }
}
