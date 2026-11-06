import {expect,it,vi} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {WorkLoopHost} from '../agent-space/workloop-host'
import {createContactTools} from './tools'
import type {ToolExecutionContext} from '../tools/registry'
it('routes a chat design request to its independent queue without modifying author prose or state',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'chouyu-design-flow-')),model=vi.fn()
  const host=new WorkLoopHost(directory,()=>{},()=>model)
  try{
    await host.sync([{id:'writer',soul:'writer',conversation:'',config:null}])
    const topic=host.store.topics.create('writer',{title:'Book',goal:'Write',constraints:''}),run=host.store.createRun('writer','',Date.now(),topic.id)
    host.store.finish(run,{runId:run,title:'Chapter',body:'Saved prose',nextStep:'Continue',evidence:[],createdAt:Date.now()},[],{status:'researching',judgement:'Saved',reason:'Written',nextStep:'Continue',openQuestions:''})
    const before=host.store.deliveries.get(topic.id),state=host.store.topics.get('writer',topic.id)
    const tools=createContactTools({owner:()=> 'writer',dispatchUnknown:(method,id,args)=>host.dispatchUnknown(method,id,args)})
    expect(tools.some(t=>t.name==='revise_contact_presentation')).toBe(false)
    const tool=tools.find(t=>t.name==='request_result_design')!,context={sessionId:'chat',executionId:'request-1'} as ToolExecutionContext
    const prepared=await tool.prepareAsync!({topicId:topic.id,reason:'A readable book layout'},context)
    const first=JSON.parse((await prepared.execute()).content),again=JSON.parse((await prepared.execute()).content)
    expect(first.requestAccepted).toBe(true);expect(again.requestId).toBe(first.requestId)
    expect(host.store.designs.pending()).toHaveLength(1)
    expect(host.store.deliveries.get(topic.id)).toEqual(before);expect(host.store.topics.get('writer',topic.id)).toEqual(state)
    expect(model).not.toHaveBeenCalled()
    await expect(host.request('resultGet','writer',[{domain:'contact',ownerId:'someone-else',taskId:topic.id}])).rejects.toThrow()
  }finally{await host.close();rmSync(directory,{recursive:true,force:true})}
})
