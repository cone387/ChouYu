import {afterEach,expect,it} from 'vitest'
import {ContactTaskStore} from '../task-center/contact-store'
import {runResultDesign} from './workflow'
import {sourceSnapshot} from '../../shared/result-design'
const stores:ContactTaskStore[]=[]
afterEach(()=>stores.splice(0).forEach(s=>s.close()))
it('requires actual image messages and four checked environments before publishing',async()=>{
  const store=new ContactTaskStore(':memory:');stores.push(store)
  const source=sourceSnapshot({domain:'contact',ownerId:'a',taskId:'t'},'1','结果',[{id:'s',title:'章节',body:'正式正文',sources:[]}],[])
  const receipt=store.designs.accept(source,'result-ui-v1'),job=store.designs.claim(receipt.requestId,'run')
  let rounds=0,images=0,closed=0
  await runResultDesign(job,{store:store.designs,source:{read:async()=>source,latest:async()=>source,assertCurrent:async()=>{}},
    model:async(messages)=>{rounds++;images+=messages.filter(m=>m.imageUrl).length;return {requestId:`call-${rounds}`,text:rounds===1?JSON.stringify({title:'阅读',html:'',css:'',script:''}):JSON.stringify({accepted:true,feedback:'四个视口均能完整阅读，导航清晰。'})}},
    preview:{open:async input=>({inspect:async()=>({...input.environment,screenshotId:'actual',imageUrl:'data:image/png;base64,real',contentComplete:true,interactionsPassed:true,errors:[],controls:[]}),act:async()=>({...input.environment,screenshotId:'actual',imageUrl:'data:image/png;base64,real',contentComplete:true,interactionsPassed:true,errors:[],controls:[]}),close:async()=>{closed++}})}},new AbortController().signal)
  expect(images).toBe(4);expect(closed).toBe(4);expect(store.designs.view(source.ref).active?.evidence?.visualReview.requestId).toBe('call-2')
})
it('never publishes a page with missing prose even when the model says accepted',async()=>{
  const store=new ContactTaskStore(':memory:');stores.push(store)
  const source=sourceSnapshot({domain:'contact',ownerId:'a',taskId:'t'},'1','结果',[{id:'s',title:'节',body:'正文',sources:[]}],[])
  const job=store.designs.claim(store.designs.accept(source,'result-ui-v1').requestId,'run')
  let rounds=0
  await expect(runResultDesign(job,{store:store.designs,source:{read:async()=>source,latest:async()=>source,assertCurrent:async()=>{}},
    model:async()=>({requestId:'call',text:++rounds%2?JSON.stringify({title:'阅读',html:'',css:'',script:''}):JSON.stringify({accepted:true,feedback:'通过'})}),
    preview:{open:async input=>({inspect:async()=>({...input.environment,screenshotId:'actual',imageUrl:'data:image/png;base64,real',contentComplete:false,interactionsPassed:true,errors:[],controls:[]}),act:async()=>({...input.environment,screenshotId:'actual',imageUrl:'data:image/png;base64,real',contentComplete:true,interactionsPassed:true,errors:[],controls:[]}),close:async()=>{}})}},new AbortController().signal)).rejects.toThrow(/三轮/)
  expect(rounds).toBe(6);expect(store.designs.view(source.ref).active).toBeUndefined()
})
