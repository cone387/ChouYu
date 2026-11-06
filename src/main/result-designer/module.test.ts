import { afterEach, expect, it, vi } from 'vitest'
import { ContactTaskStore } from '../task-center/contact-store'
import { RunScheduler } from '../agent-space/scheduler'
import { ResultDesignerModule } from './module'
import { sourceSnapshot, RESULT_DESIGNER_CHARACTER_ID as id } from '../../shared/result-design'
const stores:ContactTaskStore[]=[]
afterEach(()=>stores.splice(0).forEach(s=>s.close()))
it('shares capacity and retains its slot until cancellation settles',async()=>{
  const store=new ContactTaskStore(':memory:');stores.push(store)
  const scheduler=new RunScheduler(1)
  store.designs.accept(sourceSnapshot({domain:'contact',ownerId:'author',taskId:'t'},'1','标题',[{id:'s',title:'正文',body:'正文',sources:[]}],[]),'result-ui-v1')
  let finish!:()=>void, started=false
  const owner={id,identity:{id,soul:'',conversation:'',config:{provider:'openai' as const,baseUrl:'http://localhost',apiKey:'fixture',model:'test',thinkingDisabledModels:[]}}}
  const module=new ResultDesignerModule(owner,store,scheduler,async()=>{started=true;await new Promise<void>(r=>{finish=r})},()=>{})
  expect(module.advance()).toBe(true);await Promise.resolve()
  expect(started).toBe(true);expect(scheduler.size).toBe(1)
  expect(module.advance()).toBe(false)
  const closing=module.close();expect(scheduler.size).toBe(1)
  finish();await closing;expect(scheduler.size).toBe(0)
  expect(store.db.prepare('SELECT topic_id FROM runs').get()).toEqual({topic_id:null})
  expect(store.topics.list(id)).toEqual([])
})
it('holds paused sources, drains a cancelled model, and resumes saved work',async()=>{
  const store=new ContactTaskStore(':memory:');stores.push(store)
  const scheduler=new RunScheduler(1),task={domain:'contact' as const,ownerId:'author',taskId:'t'}
  store.designs.accept(sourceSnapshot(task,'1','Title',[{id:'s',title:'Body',body:'Body',sources:[]}],[]),'result-ui-v1')
  let sourceAvailable=false,calls=0
  const owner={id,identity:{id,soul:'',conversation:'',config:{provider:'openai' as const,baseUrl:'http://localhost',apiKey:'fixture',model:'test',thinkingDisabledModels:[]}}}
  const module=new ResultDesignerModule(owner,store,scheduler,async(_job,signal)=>{calls++;await new Promise<void>((_,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}))},()=>{},async()=>{if(!sourceAvailable)throw Error('paused')})
  module.prepare();await Promise.resolve();expect(module.advance()).toBe(false)
  sourceAvailable=true;await vi.waitFor(()=>{module.prepare();expect(module.advance()).toBe(true)})
  await vi.waitFor(()=>expect(calls).toBe(1))
  store.db.prepare("UPDATE profiles SET settings=json_set(settings,'$.enabled',0) WHERE character_id=?").run(id)
  module.prepare();await scheduler.drain(id);expect(store.designs.pending()).toHaveLength(1)
  expect(module.advance()).toBe(false)
  store.db.prepare("UPDATE profiles SET settings=json_set(settings,'$.enabled',1) WHERE character_id=?").run(id)
  await vi.waitFor(()=>{module.prepare();expect(module.advance()).toBe(true)})
  await vi.waitFor(()=>expect(calls).toBe(2));await module.close()
})
