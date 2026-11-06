import {randomUUID} from 'node:crypto'
import {DEFAULT_APP_CONFIG} from '../../shared/config'
import type {AIChatMessage} from '../../shared/ai'
import type {AIResponseMetadata} from '../../shared/ai-usage'
import type {ContactIdentity} from '../contact-agent/contracts'
import type {HarnessRegistry} from '../harness/registry'
import type {HarnessToolRuntime} from '../harness/tool-runtime'
import type {DesignBudget} from './budget'
export type DesignModel=(messages:AIChatMessage[],system:string,signal:AbortSignal,tools?:HarnessToolRuntime)=>Promise<{text:string;requestId:string}>
export function createDesignModel(identity:ContactIdentity,harnesses:HarnessRegistry,budget:DesignBudget,check:()=>Promise<void>):DesignModel {
  const engine=identity.backgroundHarnessEngine??'native',module=harnesses.get(engine)
  if(!module.capabilities.images)throw new Error(`${module.label} 暂不支持图片，无法完成成果视觉检查。请为设计师选择支持图片的执行器。`)
  const harness=harnesses.background(engine)
  if(!identity.config)throw new Error('设计师尚未配置模型。')
  return async(messages,systemPrompt,signal,tools)=>{
    let text='',metadata:AIResponseMetadata={model:identity.config!.model}
    const requestId=randomUUID()
    await harness.run({characterId:identity.id,requestId,messages,systemPrompt:`${identity.soul}\n${systemPrompt}`,signal,tools,config:{...DEFAULT_APP_CONFIG,...identity.config},
      onChunk:chunk=>{text+=chunk;if(text.length>100000)throw new Error('设计输出过长。')},options:{timeoutMs:120000,maxOutputTokens:12000,
        beforeRound:async(_round,input)=>{signal.throwIfAborted();await check();text='';metadata={model:identity.config!.model};return budget.reserve(input,12000).maxOutputTokens},
        onMetadata:value=>{metadata={...metadata,...value}},afterRound:()=>budget.settle(metadata)}})
    signal.throwIfAborted();await check();return {text,requestId}
  }
}
