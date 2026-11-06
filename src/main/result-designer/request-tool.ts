import {randomUUID} from 'node:crypto'
import {contactCommandDispatcher,type UnknownContactDispatch} from '../task-center/command-boundary'
import type {RegisteredTool} from '../tools/registry'
export function createResultDesignTools(access:{owner(sessionId?:string):string|undefined;dispatchUnknown:UnknownContactDispatch}):RegisteredTool[]{
  const request=contactCommandDispatcher(access.dispatchUnknown)
  return [{name:'request_result_design',displayName:'交给界面设计师',source:'builtin',risk:'write',requiresConfirmation:true,alwaysConfirm:true,
    description:'将当前联系人任务的成果界面要求持久交给独立设计师。不会启动作者正文修订；返回排队回执时不能说已改好。先读取真实任务ID及正式成果。',
    inputSchema:{type:'object',properties:{topicId:{type:'string'},reason:{type:'string'},deliveryVersion:{type:'number'},revision:{type:'number'}},required:['topicId','reason'],additionalProperties:false},
    async prepareAsync(args,context){
      const owner=access.owner(context.sessionId);if(!owner)throw new Error('联系人不存在。')
      const task={domain:'contact' as const,ownerId:owner,taskId:String(args.topicId)},view=await request('resultGet',owner,[task])
      if(!view.source)throw new Error('尚无正式成果。')
      if(args.deliveryVersion!==undefined&&String(args.deliveryVersion)!==view.source.ref.sourceId)throw new Error('成果版本已变化，请重新读取。')
      if(typeof args.reason!=='string'||!args.reason.trim()||args.reason.length>8000)throw new Error('请描述成果展示要求。')
      const reason=args.reason,identity=context.taskRequest?.requestId??context.executionId??randomUUID()
      return {preview:`交给界面设计师：${view.source.title}\n${reason}`,execute:async()=>{
        if(access.owner(context.sessionId)!==owner)throw new Error('会话归属已变化。')
        const current=await request('resultGet',owner,[task])
        if(current.source?.ref.contentHash!==view.source!.ref.contentHash||current.source?.ref.sourceId!==view.source!.ref.sourceId)throw new Error('成果版本已变化，请重新核对展示要求。')
        const receipt=await request('resultRequest',owner,[task,reason,identity,view.source!.ref])
        return {content:JSON.stringify({...receipt,requestAccepted:true,workCompleted:false,message:'展示要求已保存，界面设计师将读取正式成果并制作页面。'}),summary:'已交给界面设计师'}
      }}
    },execute(){throw new Error('请先核对展示修改要求。')}}]
}
