import {expect,it} from 'vitest'
import {createBackgroundHarnesses} from '../harness/background'
import {createDesignModel} from './model'
import type {DesignBudget} from './budget'
import {createServer} from 'node:http'
it('blocks non-visual engines before any provider call without changing engine',()=>{
  expect(()=>createDesignModel({id:'result-designer',soul:'',conversation:'',config:null,backgroundHarnessEngine:'dsh'},createBackgroundHarnesses({home:"unused",node:"unused",helper:"unused"}),{} as DesignBudget,async()=>{})).toThrow(/不支持图片/)
})
it.each([
  ['API error 400: image_url is not supported by this model',true],
  ["API error 400: messages.content.type 参数非法，取值范围 ['text']",true],
  ['API error 401: invalid api key',false],
  ['API error 429: rate limit',false]
])('explains explicit provider image rejection without misclassifying other errors: %s',async(message,visual)=>{
  // Exercise the actual Native protocol boundary; no credential or remote call.
  const server=createServer((request,response)=>{request.resume();response.writeHead(visual?400:message.includes('401')?401:429,{'content-type':'application/json'});response.end(JSON.stringify({error:{message}}))})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  try{
    const model=createDesignModel({id:'result-designer',soul:'',conversation:'',config:{provider:'openai',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,apiKey:'fixture',model:'text-only',thinkingDisabledModels:[]}},createBackgroundHarnesses(),{reserve:()=>({maxOutputTokens:12000}),settle:()=>{}} as unknown as DesignBudget,async()=>{})
    await expect(model([{role:'user',content:'Inspect this page',imageUrl:'data:image/png;base64,aGVsbG8='}],'Review',AbortSignal.timeout(10000))).rejects.toThrow(visual?/支持图片的模型/:message.includes('401')?/401/:/429/)
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
})
