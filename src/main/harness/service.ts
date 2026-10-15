import { app } from 'electron'
import { join } from 'node:path'
import { HarnessStore } from './store'
import { DshRuntimePool } from './dsh/runtime'
import { DshAdapter } from './dsh/adapter'
import { ActionResults } from './action-results'
import { contactAgentsCall,onContactContextChanged } from '../agents'
let instance:ReturnType<typeof create>|undefined
function create(){
 const home=join(app.getPath('userData'),'harness')
 const root=app.isPackaged?join(process.resourcesPath,'dsh-runtime'):join(app.getAppPath(),'out','dsh-runtime')
 const store=new HarnessStore(join(home,'runs.db'))
 const pool=new DshRuntimePool({home:join(home,'logs'),node:join(root,'node.exe'),helper:join(root,'helper.mjs')})
 const actions=new ActionResults(store,{read:(owner,id)=>contactAgentsCall(owner,'getInteraction',[id]),subscribe:onContactContextChanged,cancel:(owner,id,version)=>contactAgentsCall(owner,'cancelPendingAction',[id,version])})
 const adapter=new DshAdapter(pool,store,key=>actions.cancelPendingActions(key))
 return {store,pool,actions,adapter}
}
export function dshService(){return instance??=create()}
export function existingDshService(){return instance}
export async function closeDshService(){if(instance){const current=instance;instance=undefined;await current.pool.close();current.store.close()}}
