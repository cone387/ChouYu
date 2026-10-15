import type { Socket } from 'node:net'
export class RpcPeer {
  constructor(socket:Socket, onRequest:(method:string,value:any)=>unknown|Promise<unknown>, onClose?:()=>void)
  closed:boolean
  request(method:string,value:unknown,options?:{signal?:AbortSignal;timeoutMs?:number}):Promise<any>
  close(error?:Error):void
}
