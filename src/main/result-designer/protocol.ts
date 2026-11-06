import {app,protocol} from 'electron'
import {randomUUID} from 'node:crypto'
import {resultDesignDocument,resultDesignPolicy} from '../../shared/result-design-document'
import {designEnvironment} from '../../shared/result-design-environment'
import {validateTaskRef,type ResultTaskRef,type ResultDesignRecord,type ResultSourceSnapshot} from '../../shared/result-design'
protocol.registerSchemesAsPrivileged([{scheme:'chouyu-result',privileges:{standard:true,secure:true}}])
app.on('web-contents-created',(_event,contents)=>{
  contents.on('will-frame-navigate',event=>{if(event.frame?.url.startsWith('chouyu-result:')||event.initiator?.url.startsWith('chouyu-result:'))event.preventDefault()})
})
export function registerResultProtocol(read:(task:ResultTaskRef,id:string)=>Promise<{record:ResultDesignRecord;source:ResultSourceSnapshot}>){
  protocol.handle('chouyu-result',async request=>{
    try{
      const url=new URL(request.url),parts=url.pathname.split('/').filter(Boolean)
      if(request.method!=='GET'||url.hostname!=='view'||parts.length!==4)throw Error('Not found')
      const task=validateTaskRef({domain:parts[0],ownerId:parts[1],taskId:parts[2]}),id=parts[3]
      if(!/^[a-zA-Z0-9_-]{1,160}$/.test(id))throw Error('Not found')
      const {record,source}=await read(task,id),nonce=randomUUID()
      const theme=url.searchParams.get('theme')==='dark'?'dark':'light'
      return new Response(resultDesignDocument(source,record.code,designEnvironment(1024,theme),nonce),{headers:{'Content-Type':'text/html; charset=utf-8',
        'Content-Security-Policy':`${resultDesignPolicy(nonce)}; sandbox allow-scripts`,'Cache-Control':'no-store'}})
    }catch{return new Response('展示暂不可用，请查看原文。',{status:404})}
  })
}
