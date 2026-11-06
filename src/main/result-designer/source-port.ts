import type {ResultSourcePort} from './sources'
import type {ResultTaskRef,ResultSourceRef,ResultSourceSnapshot} from '../../shared/result-design'
export type SourceRequest={sequence:number;operation:'latest'|'version'|'read'|'assertCurrent';task:ResultTaskRef|ResultSourceRef;sourceId?:string;intent?:'automatic'|'explicit'}
export class WorkerAssistantSources implements ResultSourcePort {
  private sequence=0
  private pending=new Map<number,{resolve(v:any):void;reject(e:Error):void;timer:ReturnType<typeof setTimeout>}>()
  constructor(private send:(request:SourceRequest)=>void){}
  private call(input:Omit<SourceRequest,'sequence'>,signal:AbortSignal):Promise<any>{
    signal.throwIfAborted()
    return new Promise((resolve,reject)=>{
      const sequence=++this.sequence,timer=setTimeout(()=>{this.pending.delete(sequence);reject(new Error('助手成果读取超时。'))},15000)
      this.pending.set(sequence,{resolve:v=>{try{signal.throwIfAborted();resolve(v)}catch(e){reject(e)}},reject,timer})
      this.send({...input,sequence})
    })
  }
  receive(sequence:number,result:unknown,error?:string){const row=this.pending.get(sequence);if(!row)return;this.pending.delete(sequence);clearTimeout(row.timer);if(error)row.reject(new Error(error));else row.resolve(result)}
  latest(task:ResultTaskRef,signal:AbortSignal):Promise<ResultSourceSnapshot|null>{return this.call({operation:'latest',task},signal)}
  version(task:ResultTaskRef,sourceId:string,signal:AbortSignal):Promise<ResultSourceSnapshot|null>{return this.call({operation:'version',task,sourceId},signal)}
  read(task:ResultSourceRef,signal:AbortSignal):Promise<ResultSourceSnapshot>{return this.call({operation:'read',task},signal)}
  assertCurrent(task:ResultSourceRef,intent:'automatic'|'explicit',signal:AbortSignal):Promise<void>{return this.call({operation:'assertCurrent',task,intent},signal)}
}
