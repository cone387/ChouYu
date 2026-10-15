import { app } from 'electron'
import { join } from 'node:path'
import {existsSync} from 'node:fs'
import { HarnessStore } from './store'
import { DshRuntimePool,inspectDshRun } from './dsh/runtime'
import {recoverHarnessRuns,purgeHarnessRuns} from './recovery'
import {purgeRunLogs} from './logs'
import {getSession,saveSessionMessages,flushDatabase,setState,getState} from '../database'
import { DshAdapter } from './dsh/adapter'
import { ActionResults } from './action-results'
import { contactAgentsCall,onContactContextChanged } from '../agents'
let instance:ReturnType<typeof create>|undefined
let cancelRun:(requestId:string)=>Promise<void>=async()=>{}
export function setHarnessCancellation(cancel:typeof cancelRun){cancelRun=cancel}
function create(){
 const home=join(app.getPath('userData'),'harness')
 const root=app.isPackaged?join(process.resourcesPath,'dsh-runtime'):join(app.getAppPath(),'out','dsh-runtime')
 const store=new HarnessStore(join(home,'runs.db'))
 const options={home:join(home,'logs'),node:join(root,'node.exe'),helper:join(root,'helper.mjs')}
 const pool=new DshRuntimePool(options)
 const actions=new ActionResults(store,{read:(owner,id)=>contactAgentsCall(owner,'getInteraction',[id]),subscribe:onContactContextChanged,cancel:(owner,id,version)=>contactAgentsCall(owner,'cancelPendingAction',[id,version])})
 const adapter=new DshAdapter(pool,store,key=>actions.cancelPendingActions(key))
 return {store,pool,actions,adapter,options}
}
export function dshService(){return instance??=create()}
export function assertDshRecovered(){const error=getState('harness:recovery-error');if(error)throw new Error(`执行记录尚未核对完成：${error}`)}
export async function cleanSavedDshRun(run:import('./store').RunRecord){const service=dshService();service.store.markCleanup(run,true);await purgeRunLogs(service.options.home,run);service.store.markCleanup(run,false)}
export function existingDshService(){return instance}
export async function closeDshService(){if(instance){const current=instance;instance=undefined;await current.pool.close();current.store.close()}}
export async function recoverDshService(){
 if(!existsSync(join(app.getPath('userData'),'harness','runs.db')))return
 const service=dshService()
 await recoverHarnessRuns(service.store,{
  hasMessage:async run=>Boolean(getSession(run.sessionId)?.messages.some(m=>m.id===run.messageId)),
  readCommitted:run=>inspectDshRun(service.options,run),
  save:async(run,text)=>{
   const session=getSession(run.sessionId)
   if(!session||session.characterId!==run.characterId)throw new Error('原会话已不存在，未恢复回复。')
   if(!session.messages.some(m=>m.id===run.messageId))saveSessionMessages(session.id,[...session.messages,{id:run.messageId,role:'assistant',content:text,timestamp:run.createdAt,replyCompletedAt:Date.now(),harnessSource:{requestId:run.requestId,attemptId:run.attemptId,engine:'dsh',version:run.version,messageId:run.messageId}}])
   const saved=flushDatabase();if(saved.error)throw new Error(saved.error)
  },purge:run=>purgeRunLogs(service.options.home,run)
 })
}
export async function purgeHarnessData(scope:{characterId:string;sessionId?:string;sourceIds?:string[]}){
 if(!instance&&!existsSync(join(app.getPath('userData'),'harness','runs.db')))return {ok:true,pendingRunIds:[]}
 const service=dshService()
 const result=await purgeHarnessRuns(service.store,scope,{cancel:run=>cancelRun(run.requestId),purge:run=>purgeRunLogs(service.options.home,run)})
 setState('harness:cleanup-error',result.ok?'':`仍有 ${result.pendingRunIds.length} 份执行日志未清理，请重试原删除操作。`)
 if(!result.ok)throw new Error(`仍有 ${result.pendingRunIds.length} 份执行日志未清理，请重试原删除操作。`)
 return result
}
