import {expect,it} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {WorkLoopHost} from '../agent-space/workloop-host'
import {sourceSnapshot,taskKey,RESULT_DESIGNER_CHARACTER_ID as designer} from '../../shared/result-design'
import {DEFAULT_CHARACTER_ID} from '../../shared/characters'

it('rejects stale UI requests and retains delivery on transient reads, suppressing restored notices',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'design-host-'))
  const source=sourceSnapshot({domain:'assistant',ownerId:DEFAULT_CHARACTER_ID,taskId:'routine'},'execution','Report',[{id:'s',title:'Body',body:'Saved body',sources:[]}],[])
  let readError='temporary RPC timeout'
  const host=new WorkLoopHost(dir,()=>{},undefined,undefined,undefined,undefined,undefined,{assistantSources:{
    latest:async()=>source,read:async()=>{if(readError)throw Error(readError);return source},assertCurrent:async()=>{}
  }})
  try{
    await host.sync([DEFAULT_CHARACTER_ID,designer].map(id=>({id,soul:'',conversation:'',config:null,workLoopEnabled:false})))
    const view=await host.request('resultGet',DEFAULT_CHARACTER_ID,[source.ref])
    await expect(host.request('resultRequest',DEFAULT_CHARACTER_ID,[source.ref,'Change layout','request',{...source.ref,sourceId:'older'}])).rejects.toThrow(/已更新/)
    const receipt=await host.request('resultRequest',DEFAULT_CHARACTER_ID,[source.ref,'Change layout','request',source.ref])
    expect(receipt.requestRevision).toBe(view.receipt!.requestRevision+1)
    expect(await host.request('resultRequest',DEFAULT_CHARACTER_ID,[source.ref,'Change layout','request',source.ref])).toEqual(receipt)
    const notice={id:'design',task:source.ref,source:source.ref,title:'Report',createdAt:1}
    host.store.db.prepare('INSERT INTO result_design_notices(id,task_key,value) VALUES(?,?,?)').run(notice.id,taskKey(source.ref),JSON.stringify(notice))
    await expect(host.request('designNotices',designer)).rejects.toThrow(/timeout/)
    expect(host.store.designs.notices()).toHaveLength(1)
    readError='';expect(await host.request('designNotices',designer)).toHaveLength(1)
    host.store.recovery.sync(designer,{restoreId:'restored',scopeReviewed:false,allowedTopics:[]})
    expect(await host.request('designNotices',designer)).toEqual([])
  }finally{await host.close();rmSync(dir,{recursive:true,force:true})}
})
