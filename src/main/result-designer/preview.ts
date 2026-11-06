import {BrowserWindow,session as electronSession} from 'electron'
import {randomUUID} from 'node:crypto'
import {mkdirSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {resultDesignDocument} from '../../shared/result-design-document'
import type {PreviewAction,PreviewObservation} from '../../shared/result-design'
import type {DesignPreviewPort,PreviewInput,PreviewSession,PreviewRequest} from './preview-port'

/** Dedicated renderer, ephemeral session, no preload or Node, no network or navigation. */
export class ElectronDesignPreview implements DesignPreviewPort {
  private sessions=new Map<string,PreviewSession>()
  constructor(private directory:string){}
  async dispatch(message:PreviewRequest):Promise<unknown>{
    if(message.operation==='open'){
      const id=randomUUID(),session=await this.open(message.input,new AbortController().signal)
      this.sessions.set(id,session);return id
    }
    const session=this.sessions.get(message.sessionId)
    if(message.operation==='close'){if(session)await session.close();this.sessions.delete(message.sessionId);return}
    if(!session)throw new Error('预览会话已关闭。')
    return message.operation==='act'?session.act(message.action):session.inspect()
  }
  async close(){const sessions=[...this.sessions.values()];this.sessions.clear();await Promise.all(sessions.map(s=>s.close()))}
  async open(input:PreviewInput,signal:AbortSignal):Promise<PreviewSession>{
    signal.throwIfAborted()
    const {width,height,theme}=input.environment
    if(![375,1024].includes(width)||height!==(width===375?700:768)||!['light','dark'].includes(theme))throw new Error('预览视口无效。')
    const ses=electronSession.fromPartition(`result-preview-${randomUUID()}`)
    ses.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));ses.setPermissionCheckHandler(()=>false)
    ses.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('data:text/html')}))
    const window=new BrowserWindow({show:false,width,height,useContentSize:true,focusable:false,webPreferences:{session:ses,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,backgroundThrottling:false}})
    let closed=false
    const close=async()=>{if(closed)return;closed=true;clearTimeout(lifetime);signal.removeEventListener('abort',aborted);if(!window.isDestroyed())window.destroy();await ses.clearStorageData()}
    const aborted=()=>{void close()};signal.addEventListener('abort',aborted,{once:true})
    const lifetime=setTimeout(()=>{void close()},120000)
    const errors:string[]=[]
    window.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message.slice(0,400))})
    window.webContents.on('render-process-gone',()=>errors.push('预览进程已退出'))
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}))
    window.webContents.on('will-navigate',e=>e.preventDefault());window.webContents.on('will-attach-webview',e=>e.preventDefault())
    const bounded=async<T>(run:()=>Promise<T>):Promise<T>=>{
      if(closed)throw new Error('预览会话已关闭。');signal.throwIfAborted()
      let timer:ReturnType<typeof setTimeout>|undefined
      try{return await Promise.race([run(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{void close();reject(new Error('预览操作超时。'))},15000)})])}
      finally{clearTimeout(timer)}
    }
    // Code passed here is host-owned and runs in a separate JavaScript world.
    const inspect=async():Promise<PreviewObservation>=>bounded(async()=>{
      const observations=await window.webContents.executeJavaScriptInIsolatedWorld(999,[{code:`(()=>{
        const sections=${JSON.stringify(input.snapshot.sections.map(s=>({id:s.id,body:s.body}))).replace(/</g,'\\u003c')};
        const visible=el=>{for(let p=el;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)<0.9||parseFloat(s.fontSize)<12||s.clipPath!=='none'||s.filter!=='none')return false;if(['hidden','clip'].includes(s.overflowY)&&p.scrollHeight>p.clientHeight+2)return false}const r=el.getBoundingClientRect();return r.width>40&&r.height>12&&el.scrollHeight<=el.clientHeight+2};
        const complete=sections.every(s=>{const nodes=[...document.querySelectorAll('[data-result-body]')].filter(el=>el.getAttribute('data-result-body')===s.id);return nodes.length===1&&nodes[0].textContent===s.body&&visible(nodes[0])});
        const controls=[...document.querySelectorAll('button,a[href],input,select,summary')].filter(visible).slice(0,100).map((el,i)=>{el.setAttribute('data-preview-control',String(i));return {id:String(i),label:el.getAttribute('aria-label')||el.textContent?.trim()||''}});
        return {complete,controls,overflow:document.documentElement.scrollWidth>innerWidth+2};
      })()`}]) as {complete:boolean;controls:{id:string;label:string}[];overflow:boolean}
      const screenshot=await window.webContents.capturePage(),screenshotId=randomUUID()
      mkdirSync(this.directory,{recursive:true});writeFileSync(join(this.directory,`${screenshotId}.png`),screenshot.toPNG())
      return {width,height,theme,screenshotId,imageUrl:screenshot.toDataURL(),contentComplete:observations.complete,
        interactionsPassed:!observations.overflow&&observations.controls.every(c=>Boolean(c.label)),controls:observations.controls,
        errors:[...errors,...(observations.overflow?['页面横向溢出']:[])]}
    })
    try{
      await bounded(()=>window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(resultDesignDocument(input.snapshot,input.code,input.environment,randomUUID()))}`))
      return {inspect,close,act:async(action:PreviewAction)=>{
        await bounded(async()=>{
          if(action.kind==='scroll'&&Number.isFinite(action.y)&&Math.abs(action.y)<=100000)await window.webContents.executeJavaScriptInIsolatedWorld(999,[{code:`window.scrollTo(0,${action.y})`}])
          else if(action.kind==='key'&&['Tab','Enter','Escape','ArrowDown','ArrowUp'].includes(action.key)){window.webContents.sendInputEvent({type:'keyDown',keyCode:action.key});window.webContents.sendInputEvent({type:'keyUp',keyCode:action.key})}
          else if(action.kind==='click'&&/^\d{1,3}$/.test(action.target)){
            const point=await window.webContents.executeJavaScriptInIsolatedWorld(999,[{code:`(()=>{const el=document.querySelector('[data-preview-control="${action.target}"]');if(!el)throw Error('控件已失效');el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`}])
            window.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});window.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1})
          }else throw new Error('预览操作无效。')
        });return inspect()
      }}
    }catch(error){await close();throw error}
  }
}
