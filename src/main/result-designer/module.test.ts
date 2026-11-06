import { afterEach, expect, it } from 'vitest'
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
