import type {ResultSourceSnapshot} from '../../shared/result-design'
import type {HarnessToolRuntime} from '../harness/tool-runtime'
/** This catalogue cannot access any other contact or modify author tasks. */
export function designSourceTools(source:ResultSourceSnapshot,check:()=>Promise<void>):HarnessToolRuntime {
  return {definitions:[{name:'read_result_section',displayName:'读取正式成果',description:'读取当前固定成果的一节正文。使用目录中的ID；长文通过offset分页，每页6000字符。',source:'builtin',risk:'read',requiresConfirmation:false,
    inputSchema:{type:'object',properties:{sectionId:{type:'string'},offset:{type:'number'}},required:['sectionId'],additionalProperties:false}}],
    execute:async call=>{
      await check();if(call.name!=='read_result_section')throw new Error('设计工具不可用。')
      const args=JSON.parse(call.arguments),section=source.sections.find(s=>s.id===args.sectionId),offset=args.offset??0
      if(!section||!Number.isSafeInteger(offset)||offset<0||offset>section.body.length)throw new Error('成果分节或位置无效。')
      return JSON.stringify({id:section.id,title:section.title,body:section.body.slice(offset,offset+6000),offset,nextOffset:offset+6000<section.body.length?offset+6000:null,sources:section.sources})
    }}
}
