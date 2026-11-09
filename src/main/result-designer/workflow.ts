import type {DesignJob,DesignEvidence,PreviewObservation} from '../../shared/result-design'
import {validateDesignCode} from '../../shared/result-design'
import {designEnvironment,designEnvironmentInstruction} from '../../shared/result-design-environment'
import type {AIChatMessage} from '../../shared/ai'
import type {ResultDesignStore} from './store'
import type {ResultSourcePort} from './sources'
import type {DesignPreviewPort} from './preview-port'
import type {DesignModel} from './model'
import {designSourceTools} from './tools'
export interface DesignWorkflowPorts {store:ResultDesignStore;source:ResultSourcePort;model:DesignModel;preview:DesignPreviewPort}
const parse=(text:string)=>JSON.parse(text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''))
export async function runResultDesign(job:DesignJob,ports:DesignWorkflowPorts,outer:AbortSignal):Promise<void>{
  const signal=AbortSignal.any([outer,AbortSignal.timeout(600000)])
  await ports.source.assertCurrent(job.source,job.explicit?'explicit':'automatic',signal)
  const source=await ports.source.read(job.source,signal)
  const tools=designSourceTools(source,async()=>{signal.throwIfAborted();await ports.source.read(job.source,signal)},(id,start,end)=>ports.store.recordRead(job.id,id,start,end))
  for(const section of source.sections)ports.store.recordRead(job.id,section.id,0,Math.min(600,section.body.length))
  const messages:AIChatMessage[]=[{role:'user',content:JSON.stringify({task:source.title,request:job.text,
    source:source.ref,directory:source.sections.map(s=>({id:s.id,title:s.title,characters:s.body.length,opening:s.body.slice(0,600)})),
    environment:designEnvironment(1024,'light'),instruction:'先读取需要了解的正式正文，再编程设计成果界面；输出代码JSON。'})}]
  const previous=ports.store.reusable(job.task,job.environmentVersion)
  if(previous)messages.push({role:'user',content:JSON.stringify({previousCode:previous.code,instruction:'这是本任务已验证的新机制界面，保留适用的阅读设计；按本次要求和新的正文目录调整。'})})
  const reuse=previous&&!job.explicit&&JSON.stringify(ports.store.readSource(previous.source).sections.map(s=>s.id))===JSON.stringify(source.sections.map(s=>s.id))
  if(!reuse){
    const reference=await ports.preview.open({jobId:job.id,snapshot:source,code:previous?.code??{title:source.title,html:'',css:'',script:''},environment:designEnvironment(1024,'light')},signal)
    try{const view=await reference.inspect();messages.push({role:'user',content:'这是当前成果容器的实际阅读界面，作为本次设计的参考。',imageUrl:view.imageUrl})}finally{await reference.close()}
  }
  let lastFeedback=''
  for(let attempt=0;attempt<3;attempt++){
    signal.throwIfAborted()
    const response=attempt===0&&reuse?{text:JSON.stringify(previous.code),requestId:'reuse'}:await ports.model(messages,designEnvironmentInstruction,signal,tools)
    let code
    try{code=validateDesignCode(parse(response.text))}catch(error){lastFeedback=String(error);messages.push({role:'assistant',content:response.text},{role:'user',content:`代码无效：${lastFeedback}。修正后返回完整JSON。`});continue}
    const candidate=ports.store.saveCandidate(job.id,code),observations:PreviewObservation[]=[],interactionImages:PreviewObservation[]=[],readingImages:PreviewObservation[]=[]
    for(const width of [375,1024])for(const theme of ['light','dark'] as const){
      const session=await ports.preview.open({jobId:job.id,snapshot:source,code,environment:designEnvironment(width,theme)},signal)
      try{
        const first=await session.inspect();let checked=first,interactionComplete=first.contentIntact??first.contentComplete,interactionPassed=first.interactionsPassed
        const reached=new Set(first.reachedSections??[]),visited=new Set<string>()
        const errors=[...first.errors]
        const readingSamples:NonNullable<PreviewObservation['readingSamples']>=[]
        const record=(view:PreviewObservation)=>{interactionComplete&&=view.contentIntact??view.contentComplete;interactionPassed&&=view.interactionsPassed;errors.push(...view.errors);view.reachedSections?.forEach(id=>reached.add(id))}
        // Bounded representative coverage: first page plus two newly reached
        // chapter states, each at its middle and end. Never only the first screen.
        const sampleReading=async(view:PreviewObservation)=>{
          if(!view.scroll||view.scroll.maxY<view.height/2||readingSamples.length>=6)return
          for(const fraction of [0.5,1]){
            const sample=await session.act({kind:'scroll',fraction});record(sample);readingImages.push(sample)
            if(!sample.scroll||!Number.isFinite(sample.scroll.y)||!Number.isFinite(sample.scroll.maxY)||Math.abs(sample.scroll.y-sample.scroll.maxY*fraction)>2)errors.push('长文滚动未到达预定阅读位置')
            if(sample.scroll)readingSamples.push({screenshotId:sample.screenshotId,...sample.scroll})
          }
          record(await session.act({kind:'scroll',fraction:view.scroll.y/view.scroll.maxY}))
        }
        await sampleReading(first)
        for(let count=0;count<100;count++){
          const state=JSON.stringify(checked.reachedSections??[]),control=checked.controls.find(c=>!visited.has(`${c.id}:${state}`));if(!control)break
          visited.add(`${control.id}:${state}`);checked=await session.act({kind:'click',target:control.id})
          if(checked.reachedSections?.some(id=>!reached.has(id))){interactionImages.push(checked);await sampleReading(checked)}
          record(checked)
          if(checked.errors.length)break
        }
        // Keyboard and scrolling are actual renderer input, not model assertions.
        record(await session.act({kind:'key',key:'Tab'}));checked=await session.act({kind:'scroll',y:0});record(checked)
        observations.push({...first,contentComplete:interactionComplete&&(first.reachedSections?source.sections.every(s=>reached.has(s.id)):checked.contentComplete),
          interactionsPassed:interactionPassed,errors:[...new Set(errors)],readingSamples})
      }finally{await session.close()}
    }
    const reviewMessages:AIChatMessage[]=[{role:'user',content:JSON.stringify({task:source.title,request:job.text,code,
      directory:source.sections.map(s=>({id:s.id,title:s.title,characters:s.body.length})),observations:observations.map(({imageUrl,controls,...o})=>({...o,controls})),
      instruction:'逐张检查四种环境及长文中段、末尾、章节切换的真实截图：排版层级、行长、可读性、主题对比、目录和交互。检查尾部裁切、遮挡与过大留白。给出具体问题。只有全部可用且正文完整才返回 accepted:true。仅返回 {accepted:boolean,feedback:string} JSON。'})},
      ...[...observations,...interactionImages,...readingImages].map(o=>({role:'user' as const,content:`${o.width}×${o.height} ${o.theme}，滚动位置 ${o.scroll?.y??0}/${o.scroll?.maxY??0}，截图 ${o.screenshotId}`,imageUrl:o.imageUrl}))]
    const review=await ports.model(reviewMessages,'你是成果阅读界面的视觉验收员。依据实际图片与宿主检查结果验收，不能把生成代码成功当作验收成功。',signal)
    let decision:{accepted:boolean;feedback:string}
    try{decision=parse(review.text)}catch{decision={accepted:false,feedback:'视觉检查没有返回有效结果。'}}
    const valid=decision.accepted===true&&typeof decision.feedback==='string'&&decision.feedback.trim()
      &&observations.every(o=>o.imageUrl.startsWith('data:image/')&&o.contentComplete&&o.interactionsPassed&&!o.errors.length)
    if(valid){
      await ports.source.assertCurrent(job.source,job.explicit?'explicit':'automatic',signal);signal.throwIfAborted()
      const evidence:DesignEvidence={codeHash:candidate.codeHash,sourceHash:source.ref.contentHash,environmentVersion:job.environmentVersion,
        observations:observations.map(({imageUrl:_,controls:__,...o})=>o),visualReview:{requestId:review.requestId,response:review.text,accepted:true},checkedAt:Date.now()}
      ports.store.publish(job.id,candidate.id,evidence);return
    }
    lastFeedback=JSON.stringify({visual:decision.feedback,structure:observations.map(({imageUrl:_,controls:__,...o})=>o)})
    messages.push({role:'assistant',content:response.text},{role:'user',content:`实际预览未通过，请修正完整代码：${lastFeedback}`})
  }
  throw new Error(`三轮展示设计均未通过检查：${lastFeedback.slice(0,1500)}`)
}
