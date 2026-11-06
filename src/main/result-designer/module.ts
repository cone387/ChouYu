import type { ContactModule, ContactModuleOwner } from '../contact-agent/contracts'
import type { ContactTaskStore } from '../task-center/contact-store'
import type { RunScheduler } from '../agent-space/scheduler'
import type { AgentSettings } from '../../shared/agents'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { RESULT_DESIGNER_CHARACTER_ID, taskKey, type DesignJob } from '../../shared/result-design'
import { withinWorkHours } from '../../shared/work-settings'
import { createDesignRun } from './budget'

export class ResultDesignerModule implements ContactModule {
  readonly id='result-designer'
  private closed=false
  constructor(private owner:ContactModuleOwner,private store:ContactTaskStore,private scheduler:RunScheduler,
    private execute:(job:DesignJob,signal:AbortSignal)=>Promise<void>,private changed:(id:string)=>void) {
    if(owner.id!==RESULT_DESIGNER_CHARACTER_ID)throw new Error('设计模块身份无效。')
    const exists=store.profile(owner.id);store.ensure(owner.id)
    if(!exists)store.db.prepare('UPDATE profiles SET settings=? WHERE character_id=?').run(JSON.stringify({...DEFAULT_AGENT_SETTINGS,
      enabled:true,maxConcurrentTasks:1,defaultTaskTokenLimit:250000,readContactDeliveries:true,goal:'为正式任务成果设计阅读界面'}),owner.id)
  }
  prepare() {
    if(!this.allowed())this.scheduler.abort(this.owner.id)
  }
  private allowed() {
    const profile=this.store.profile(this.owner.id)
    if(this.closed||!profile||this.owner.identity.workLoopEnabled===false)return false
    const settings=JSON.parse(profile.settings) as AgentSettings
    return settings.enabled && settings.readContactDeliveries!==false && withinWorkHours(settings)
  }
  advance() {
    if(!this.allowed()||this.scheduler.activeFor(this.owner.id).length)return false
    const pending=this.store.designs.pending()[0]
    if(!pending)return false
    if(!this.owner.identity.config){this.store.designs.block(pending.requestId,'设计师尚未配置模型。');this.changed(pending.task.ownerId);return false}
    const key={id:pending.requestId,characterId:this.owner.id,topicId:taskKey(pending.task)}
    if(!this.scheduler.canStart(key,1))return false
    const job=this.store.db.transaction(()=>{
      const runId=createDesignRun(this.store)
      return this.store.designs.claim(pending.requestId,runId)
    })()
    return this.scheduler.launch({...key,id:job.runId},1,async signal=>{
      try{await this.execute(job,signal);signal.throwIfAborted();this.store.setStatus(job.runId,'completed')}
      catch(error){
        const reason=error instanceof Error?error.message:'展示设计失败。'
        try{this.store.designs.fail(job.id,signal.aborted?'cancelled':'blocked',reason)}catch{/* Source removed. */}
        this.store.db.prepare('UPDATE runs SET status=?,error=?,updated_at=? WHERE id=?').run(signal.aborted?'cancelled':'failed',reason,Date.now(),job.runId)
      }finally{this.changed(job.task.ownerId);this.changed(this.owner.id)}
    })
  }
  async close(){this.closed=true;this.scheduler.abort(this.owner.id);await this.scheduler.drain(this.owner.id)}
}
