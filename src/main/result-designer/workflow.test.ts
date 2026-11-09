import {afterEach,expect,it} from 'vitest'
import {ContactTaskStore} from '../task-center/contact-store'
import {runResultDesign} from './workflow'
import {sourceSnapshot,type PreviewAction} from '../../shared/result-design'
const stores:ContactTaskStore[]=[]
afterEach(()=>stores.splice(0).forEach(s=>s.close()))
it('generates pending explicit layout changes even when new prose has the same section IDs',async()=>{
  const store=new ContactTaskStore(':memory:');stores.push(store)
  const task={domain:'contact' as const,ownerId:'a',taskId:'updates'}
  let source=sourceSnapshot(task,'1','Book',[{id:'one',title:'Chapter',body:'Original',sources:[]}],[]),calls=0
  const ports={store:store.designs,source:{read:async()=>source,latest:async()=>source,assertCurrent:async()=>{}},
    model:async()=>({requestId:`call-${++calls}`,text:calls%2?JSON.stringify({title:'Book',html:'',css:'',script:''}):JSON.stringify({accepted:true,feedback:'Readable'})}),
    preview:{open:async(input:{environment:{width:number;height:number;theme:'light'|'dark'}})=>{const inspect=async()=>({...input.environment,screenshotId:'image',imageUrl:'data:image/png;base64,real',contentComplete:true,interactionsPassed:true,errors:[],controls:[]});return {inspect,act:inspect,close:async()=>{}}}}
  }
  await runResultDesign(store.designs.claim(store.designs.accept(source,'result-ui-v1').requestId,'first'),ports,new AbortController().signal)
  store.designs.request(task,'Move the directory to the left','explicit-edit')
  source=sourceSnapshot(task,'2','Book',[{id:'one',title:'Chapter',body:'New prose',sources:[]}],[])
  const job=store.designs.claim(store.designs.accept(source,'result-ui-v1').requestId,'second')
  await runResultDesign(job,{...ports,model:async(messages,system)=>{if(calls===2){expect(system).not.toContain('视觉验收员');expect(messages.some(m=>m.content.includes('Move the directory'))).toBe(true)}return ports.model()}},new AbortController().signal)
  expect(calls).toBe(4);expect(job.explicit).toBe(true)
  store.designs.accept(sourceSnapshot(task,'3','Book',[{id:'one',title:'Chapter',body:'Later prose',sources:[]}],[]),'result-ui-v1')
  expect(store.designs.pending()[0].explicit).toBe(false)
})
it.each([false,true,'stuck'] as const)('reviews long-page middle and end and rejects errors there: %s',async(broken)=>{
  const store=new ContactTaskStore(':memory:');stores.push(store)
  const source=sourceSnapshot({domain:'contact',ownerId:'a',taskId:'long'},'1','Long',[{id:'one',title:'Prose',body:'paragraph\n'.repeat(800),sources:[]}],[])
  const job=store.designs.claim(store.designs.accept(source,'result-ui-v1').requestId,'run')
  let calls=0;const reviewed:string[]=[]
  const result=runResultDesign(job,{store:store.designs,source:{read:async()=>source,latest:async()=>source,assertCurrent:async()=>{}},
    model:async messages=>{calls++;if(calls%2===0)reviewed.push(...messages.filter(m=>m.imageUrl).map(m=>m.imageUrl!));return {requestId:'call',text:calls%2?JSON.stringify({title:'Long',html:'',css:'',script:''}):JSON.stringify({accepted:true,feedback:'Readable'})}},
    preview:{open:async input=>{
      let y=0;const inspect=async()=>({...input.environment,screenshotId:`at-${y}`,imageUrl:`data:image/png;base64,at-${y}`,scroll:{y,maxY:240000},contentComplete:true,contentIntact:true,reachedSections:['one'],interactionsPassed:true,errors:broken&&y===240000?['Footer covers prose']:[],controls:[]})
      return {inspect,act:async(action:PreviewAction)=>{if(action.kind==='scroll'&&broken!=='stuck')y='fraction' in action?action.fraction*240000:action.y;return inspect()},close:async()=>{}}
    }}},new AbortController().signal)
  if(broken){await expect(result).rejects.toThrow(/三轮/);expect(store.designs.view(source.ref).active).toBeUndefined()}
  else {await result;expect(store.designs.view(source.ref).active).toBeDefined()}
  if(broken!=='stuck'){expect(reviewed).toContain('data:image/png;base64,at-120000');expect(reviewed).toContain('data:image/png;base64,at-240000')}
})
it('requires actual image messages and four checked environments before publishing',async()=>{
  const store=new ContactTaskStore(':memory:');stores.push(store)
  const source=sourceSnapshot({domain:'contact',ownerId:'a',taskId:'t'},'1','结果',[{id:'s',title:'章节',body:'正式正文',sources:[]}],[])
  const receipt=store.designs.accept(source,'result-ui-v1'),job=store.designs.claim(receipt.requestId,'run')
  let rounds=0,images=0,closed=0
  await runResultDesign(job,{store:store.designs,source:{read:async()=>source,latest:async()=>source,assertCurrent:async()=>{}},
    model:async(messages)=>{rounds++;images+=messages.filter(m=>m.imageUrl).length;return {requestId:`call-${rounds}`,text:rounds===1?JSON.stringify({title:'阅读',html:'',css:'',script:''}):JSON.stringify({accepted:true,feedback:'四个视口均能完整阅读，导航清晰。'})}},
    preview:{open:async input=>({inspect:async()=>({...input.environment,screenshotId:'actual',imageUrl:'data:image/png;base64,real',contentComplete:true,interactionsPassed:true,errors:[],controls:[]}),act:async()=>({...input.environment,screenshotId:'actual',imageUrl:'data:image/png;base64,real',contentComplete:true,interactionsPassed:true,errors:[],controls:[]}),close:async()=>{closed++}})}},new AbortController().signal)
  expect(images).toBe(5);expect(closed).toBe(5);expect(store.designs.view(source.ref).active?.evidence?.visualReview.requestId).toBe('call-2')
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
it('accepts intact chapter tabs only after actual navigation reaches every section',async()=>{
  const store=new ContactTaskStore(':memory:');stores.push(store)
  const source=sourceSnapshot({domain:'contact',ownerId:'a',taskId:'tabs'},'1','Book',['one','two'].map(id=>({id,title:id,body:id,sources:[]})),[])
  const job=store.designs.claim(store.designs.accept(source,'result-ui-v1').requestId,'run');let calls=0,images=0
  await runResultDesign(job,{store:store.designs,source:{read:async()=>source,latest:async()=>source,assertCurrent:async()=>{}},model:async messages=>{
    images+=messages.filter(m=>m.imageUrl).length;return {requestId:`call-${++calls}`,text:calls===1?JSON.stringify({title:'Book',html:'',css:'',script:''}):JSON.stringify({accepted:true,feedback:'Both chapter tabs are readable'})}
  },preview:{open:async input=>{
    let chapter='one';const inspect=async()=>({...input.environment,screenshotId:chapter,imageUrl:'data:image/png;base64,image',contentComplete:false,contentIntact:true,reachedSections:[chapter],interactionsPassed:true,errors:[],controls:[{id:'0',label:'Next'}]})
    return {inspect,act:async action=>{if(action.kind==='click')chapter=chapter==='one'?'two':'one';return inspect()},close:async()=>{}}
  }}},new AbortController().signal)
  expect(store.designs.view(source.ref).active).toBeDefined();expect(images).toBe(9)
  expect(store.db.prepare('SELECT * FROM result_design_reads').all()).toHaveLength(2)
})
