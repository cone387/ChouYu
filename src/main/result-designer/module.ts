import type { ContactModule, ContactModuleOwner } from '../contact-agent/contracts'
import type { ContactTaskStore } from '../task-center/contact-store'
import type { RunScheduler } from '../agent-space/scheduler'
import type { AgentSettings } from '../../shared/agents'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { RESULT_DESIGNER_CHARACTER_ID, taskKey, designHash, type DesignJob, type DesignPending } from '../../shared/result-design'
import { withinWorkHours } from '../../shared/work-settings'
import { createDesignRun } from './budget'

export class ResultDesignerModule implements ContactModule {
  readonly id='result-designer'
  private closed=false
  private eligible=new Set<string>()
  private checking=false
  constructor(private owner:ContactModuleOwner,private store:ContactTaskStore,private scheduler:RunScheduler,
    private execute:(job:DesignJob,signal:AbortSignal)=>Promise<void>,private changed:(id:string)=>void,
    private available?:(job:Pick<DesignPending,'source'|'explicit'>)=>Promise<void>) {
    if(owner.id!==RESULT_DESIGNER_CHARACTER_ID)throw new Error('设计模块身份无效。')
    const exists=store.profile(owner.id);store.ensure(owner.id)
    if(!exists)store.db.prepare('UPDATE profiles SET settings=? WHERE character_id=?').run(JSON.stringify({...DEFAULT_AGENT_SETTINGS,
      enabled:true,maxConcurrentTasks:1,readContactDeliveries:true,goal:'为正式任务成果设计阅读界面'}),owner.id)
  }
  prepare() {
    if(!this.allowed())this.scheduler.abort(this.owner.id)
    this.store.designs.resumeChanged(this.signature())
    if(this.available&&!this.checking){
      this.checking=true
      void Promise.all(this.store.designs.pending().map(async pending=>{
        const key=`${pending.requestId}:${pending.requestRevision}`
        try{await this.available!(pending);this.eligible.add(key)}catch{this.eligible.delete(key)}
      })).finally(()=>{this.checking=false})
    }
  }
  private signature(){return designHash({identity:this.owner.identity.config,engine:this.owner.identity.backgroundHarnessEngine,settings:this.store.profile(this.owner.id)?.settings,enabled:this.owner.identity.workLoopEnabled})}
  private allowed() {
    const profile=this.store.profile(this.owner.id)
    if(this.closed||!profile||this.owner.identity.workLoopEnabled===false||this.owner.identity.recovery&&!this.owner.identity.recovery.scopeReviewed)return false
    const settings=JSON.parse(profile.settings) as AgentSettings
    return settings.enabled && settings.readContactDeliveries!==false && withinWorkHours(settings)
  }
  advance() {
    if(!this.allowed()||this.scheduler.activeFor(this.owner.id).length)return false
    const pending=this.store.designs.pending().find(p=>!this.available||this.eligible.has(`${p.requestId}:${p.requestRevision}`))
    if(!pending)return false
    if(!this.owner.identity.config){this.store.designs.block(pending.requestId,'设计师尚未配置模型。');this.store.designs.waitForChange(pending.requestId,this.signature());this.changed(pending.task.ownerId);return false}
    const key={id:pending.requestId,characterId:this.owner.id,topicId:taskKey(pending.task)}
    if(!this.scheduler.canStart(key,1))return false
    const job=this.store.db.transaction(()=>{
      const runId=createDesignRun(this.store)
      return this.store.designs.claim(pending.requestId,runId)
    })()
    return this.scheduler.launch({...key,id:job.runId},1,async signal=>{
      const initialSignature=this.signature()
      let checking=false
      const check=async()=>{if(checking||!this.available)return;checking=true;try{await this.available(job)}catch{this.scheduler.get(job.runId)?.controller.abort()}finally{checking=false}}
      const timer=setInterval(()=>void check(),1000)
      try{await this.execute(job,signal);signal.throwIfAborted();this.store.setStatus(job.runId,'completed')}
      catch(error){
        const reason=error instanceof Error?error.message:'展示设计失败。'
        let deferred=signal.aborted
        if(this.available)try{await this.available(job)}catch{deferred=true}
        try{this.store.designs.fail(job.id,signal.aborted?'cancelled':'blocked',reason)
          if(deferred){this.eligible.delete(`${job.requestId}:${job.requestRevision}`);this.store.designs.retry(job.requestId)}
          else this.store.designs.waitForChange(job.requestId,initialSignature)
        }catch{/* Source removed. */}
        this.store.db.prepare('UPDATE runs SET status=?,error=?,updated_at=? WHERE id=?').run(signal.aborted?'cancelled':'failed',reason,Date.now(),job.runId)
      }finally{clearInterval(timer);this.changed(job.task.ownerId);this.changed(this.owner.id)}
    })
  }
  async close(){this.closed=true;this.scheduler.abort(this.owner.id);await this.scheduler.drain(this.owner.id)}
}
