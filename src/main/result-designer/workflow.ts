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
  const tools=designSourceTools(source,async()=>{signal.throwIfAborted();await ports.source.read(job.source,signal)})
  const messages:AIChatMessage[]=[{role:'user',content:JSON.stringify({task:source.title,request:job.text,
    source:source.ref,directory:source.sections.map(s=>({id:s.id,title:s.title,characters:s.body.length,opening:s.body.slice(0,600)})),
    environment:designEnvironment(1024,'light'),instruction:'先读取需要了解的正式正文，再编程设计成果界面；输出代码JSON。'})}]
  let lastFeedback=''
  for(let attempt=0;attempt<3;attempt++){
    signal.throwIfAborted()
    const response=await ports.model(messages,designEnvironmentInstruction,signal,tools)
    let code
    try{code=validateDesignCode(parse(response.text))}catch(error){lastFeedback=String(error);messages.push({role:'assistant',content:response.text},{role:'user',content:`代码无效：${lastFeedback}。修正后返回完整JSON。`});continue}
    const candidate=ports.store.saveCandidate(job.id,code),observations:PreviewObservation[]=[]
    for(const width of [375,1024])for(const theme of ['light','dark'] as const){
      const session=await ports.preview.open({jobId:job.id,snapshot:source,code,environment:designEnvironment(width,theme)},signal)
      try{
        const first=await session.inspect();let checked=first
        for(const control of first.controls){checked=await session.act({kind:'click',target:control.id});if(!checked.contentComplete||checked.errors.length)break}
        // Keyboard and scrolling are actual renderer input, not model assertions.
        await session.act({kind:'key',key:'Tab'});checked=await session.act({kind:'scroll',y:0})
        observations.push({...first,contentComplete:first.contentComplete&&checked.contentComplete,
          interactionsPassed:first.interactionsPassed&&checked.interactionsPassed,errors:[...new Set([...first.errors,...checked.errors])]})
      }finally{await session.close()}
    }
    const reviewMessages:AIChatMessage[]=[{role:'user',content:JSON.stringify({task:source.title,request:job.text,code,
      directory:source.sections.map(s=>({id:s.id,title:s.title,characters:s.body.length})),observations:observations.map(({imageUrl,controls,...o})=>({...o,controls})),
      instruction:'逐张检查这四张真实界面截图：排版层级、可读性、主题对比、目录和交互。给出具体问题。只有全部可用且正文完整才返回 accepted:true。仅返回 {accepted:boolean,feedback:string} JSON。'})},
      ...observations.map(o=>({role:'user' as const,content:`${o.width}×${o.height} ${o.theme}，截图 ${o.screenshotId}`,imageUrl:o.imageUrl}))]
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
