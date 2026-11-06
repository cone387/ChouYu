import type {DesignEnvironment,PreviewAction,PreviewObservation,ResultDesignCode,ResultSourceSnapshot} from '../../shared/result-design'
export type PreviewInput={jobId:string;snapshot:ResultSourceSnapshot;code:ResultDesignCode;environment:DesignEnvironment}
export interface PreviewSession {
  inspect():Promise<PreviewObservation>
  act(action:PreviewAction):Promise<PreviewObservation>
  close():Promise<void>
}
export interface DesignPreviewPort {open(input:PreviewInput,signal:AbortSignal):Promise<PreviewSession>}
export type PreviewRequest={sequence:number;operation:'open';input:PreviewInput}|{sequence:number;operation:'inspect'|'close';sessionId:string}|{sequence:number;operation:'act';sessionId:string;action:PreviewAction}
/** Cancellation waits for a close receipt, so a live renderer keeps its execution slot. */
export class WorkerPreviewPort implements DesignPreviewPort {
  private sequence=0
  private pending=new Map<number,{resolve(v:any):void;reject(e:Error):void;timer:ReturnType<typeof setTimeout>}>()
  constructor(private send:(message:PreviewRequest)=>void){}
  private request(input:Omit<Extract<PreviewRequest,{operation:'open'}>,'sequence'>|{operation:'inspect'|'close';sessionId:string}|{operation:'act';sessionId:string;action:PreviewAction}):Promise<any>{
    return new Promise((resolve,reject)=>{
      const sequence=++this.sequence
      const timer=setTimeout(()=>{this.pending.delete(sequence);reject(new Error('界面预览进程未响应。'))},16000)
      this.pending.set(sequence,{resolve,reject,timer});this.send({...input,sequence} as PreviewRequest)
    })
  }
  receive(sequence:number,result:unknown,error?:string){const row=this.pending.get(sequence);if(!row)return;this.pending.delete(sequence);clearTimeout(row.timer);if(error)row.reject(new Error(error));else row.resolve(result)}
  async open(input:PreviewInput,signal:AbortSignal):Promise<PreviewSession>{
    signal.throwIfAborted()
    const sessionId=await this.request({operation:'open',input}) as string
    let closing:Promise<void>|undefined
    const close=()=>closing??=(this.request({operation:'close',sessionId}).then(()=>{signal.removeEventListener('abort',aborted)}))
    const aborted=()=>{void close().catch(()=>{})};signal.addEventListener('abort',aborted,{once:true})
    if(signal.aborted){await close();signal.throwIfAborted()}
    return {inspect:()=>{signal.throwIfAborted();return this.request({operation:'inspect',sessionId})},act:action=>{signal.throwIfAborted();return this.request({operation:'act',sessionId,action})},close}
  }
}
