import {useEffect,useRef,useState,type ReactNode} from 'react'
import {taskKey,type DesignView,type ResultDesignRecord,type ResultTaskRef} from '../../../../shared/result-design'
import ResultDesignDialog from './ResultDesignDialog'
import ContactMarkdown from './ContactMarkdown'
import {readingScrollContainer} from './deliveryScroll'
import './ResultDesignView.css'
type Props={task:ResultTaskRef;sourceId?:string;active?:boolean;forcePlain?:boolean;onModeChange?:(designed:boolean)=>void;children?:ReactNode}
export default function ResultDesignView(props:Props){return <Reader key={`${taskKey(props.task)}:${props.sourceId??'latest'}`} {...props}/>}
function Reader({task,sourceId,active=true,forcePlain=false,onModeChange,children}:Props){
  const [view,setView]=useState<DesignView>(),[pinned,setPinned]=useState<ResultDesignRecord>(),[plain,setPlain]=useState(false)
  const [error,setError]=useState(''),[dialog,setDialog]=useState(false),[failed,setFailed]=useState(false)
  const [frameHeight,setFrameHeight]=useState(400)
  const [theme,setTheme]=useState(()=>typeof document==='undefined'?'light':document.documentElement.dataset.theme||'light')
  const first=useRef(true),fixedSource=useRef(sourceId),frame=useRef<HTMLIFrameElement>(null),busy=useRef(false),loadTimer=useRef<ReturnType<typeof setTimeout>>()
  const initialTheme=useRef(theme)
  const callback=useRef(onModeChange);callback.current=onModeChange
  const pinnedRef=useRef(pinned);pinnedRef.current=pinned
  const designed=Boolean(pinned&&!plain&&!failed)
  useEffect(()=>{if(forcePlain)setPlain(true)},[forcePlain])
  useEffect(()=>callback.current?.(designed),[designed])
  useEffect(()=>{
    if(!active)return
    let alive=true
    const refresh=async()=>{
      if(document.hidden||busy.current)return;busy.current=true
      const requestedSource=fixedSource.current
      try{const next=await window.electronAPI.resultDesign.get(task,requestedSource)
        if(!alive||requestedSource!==fixedSource.current)return
        if(!fixedSource.current&&next.source)fixedSource.current=next.source.ref.sourceId
        setView(next);setError('');if(first.current){setPinned(next.active);first.current=false}
      }catch(e){if(alive)setError(e instanceof Error?e.message:String(e))}finally{busy.current=false}
    }
    void refresh();const unsubscribe=window.electronAPI.resultDesign.onChanged(refresh),timer=window.setInterval(refresh,5000)
    document.addEventListener('visibilitychange',refresh)
    return()=>{alive=false;unsubscribe();clearInterval(timer);document.removeEventListener('visibilitychange',refresh)}
  },[active,task.domain,task.ownerId,task.taskId])
  useEffect(()=>{
    const observer=new MutationObserver(()=>setTheme(document.documentElement.dataset.theme||'light'))
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']})
    const receive=(event:MessageEvent)=>{
      const iframe=frame.current
      if(!iframe||event.source!==iframe.contentWindow)return
      if(event.data?.type==='result-design-ready')clearTimeout(loadTimer.current)
      if(event.data?.type==='result-design-error'){clearTimeout(loadTimer.current);setFailed(true);setError('展示运行出错，已为你打开原文。')}
      const source=event.data?.source,expected=pinnedRef.current?.source
      if(!source||!expected||source.domain!==expected.domain||source.ownerId!==expected.ownerId||source.taskId!==expected.taskId||source.sourceId!==expected.sourceId||source.contentHash!==expected.contentHash)return
      if(event.data.type==='result-design-size'){
        const height=event.data.height
        if(!Number.isFinite(height)||height<1||height>1000000){setFailed(true);setError('展示尺寸异常，已为你打开原文。');return}
        setFrameHeight(Math.ceil(height))
      }
      if(event.data.type==='result-design-scroll'){
        const scroller=readingScrollContainer(iframe),key=event.data.key,step=scroller.clientHeight*.85
        if(key==='Home')scroller.scrollTop=0
        else if(key==='End')scroller.scrollTop=scroller.scrollHeight
        else if(['PageDown','PageUp',' '].includes(key))scroller.scrollTop+=key==='PageUp'||key===' '&&event.data.shift?-step:step
      }
    }
    window.addEventListener('message',receive);return()=>{observer.disconnect();window.removeEventListener('message',receive)}
  },[])
  const sendTheme=()=>frame.current?.contentWindow?.postMessage({type:'result-design-theme',theme:theme==='dark'?'dark':'light'},'*')
  useEffect(sendTheme,[theme,pinned?.id])
  useEffect(()=>{if(!designed)return;loadTimer.current=setTimeout(()=>{setFailed(true);setError('展示打开超时，已为你打开原文。')},15000);return()=>clearTimeout(loadTimer.current)},[pinned?.id,designed])
  const status=view?.receipt?.state,newer=view?.active&&view.active.id!==pinned?.id
  const retry=async()=>{try{await window.electronAPI.resultDesign.retry(task);setError('')}catch(e){setError(String(e))}}
  const latest=async()=>{try{const next=await window.electronAPI.resultDesign.get(task);fixedSource.current=next.source?.ref.sourceId;setView(next);setPinned(next.active);setPlain(false);setFailed(false);setError('')}catch(e){setError(String(e))}}
  const restore=async(id:string)=>{try{const next=await window.electronAPI.resultDesign.restore(task,id);setView(next);setPinned(next.active);setPlain(false);setFailed(false);setError('')}catch(e){setError(String(e))}}
  return <div className="result-design-view" data-result-design-view>
    <div className="result-design-toolbar">
      <div>{pinned?<><button type="button" aria-pressed={designed} onClick={()=>{setPlain(false);setFailed(false);setError('')}}>成果界面</button><button type="button" aria-pressed={!designed} onClick={()=>setPlain(true)}>原文</button></>:<span className="agent-caption">{status==='queued'?'界面设计已排队':status==='running'||status==='validating'?'界面设计师正在制作展示':'正式成果'}</span>}</div>
      <button type="button" disabled={!view?.source} onClick={()=>setDialog(true)}>调整界面</button>
    </div>
    {newer&&<p role="status">新版界面已准备好。<button type="button" onClick={()=>{setPinned(view.active);setPlain(false);setFailed(false)}}>查看新版界面</button></p>}
    {!sourceId&&view?.newSourceId&&<p role="status">有新的正式成果。<button type="button" onClick={()=>void latest()}>阅读最新成果</button></p>}
    {(error||view?.error)&&<p role="alert">{error||view?.error}{['blocked','failed','cancelled'].includes(status??'')&&<button type="button" onClick={()=>void retry()}>重试设计</button>}</p>}
    {designed&&<iframe ref={frame} sandbox="allow-scripts" referrerPolicy="no-referrer" title={pinned!.code.title}
      style={{height:frameHeight}}
      src={`chouyu-result://view/${task.domain}/${encodeURIComponent(task.ownerId)}/${encodeURIComponent(task.taskId)}/${pinned!.id}?theme=${initialTheme.current==='dark'?'dark':'light'}`} onLoad={sendTheme}
      onError={()=>{setFailed(true);setError('展示暂时无法打开，已为你保留原文。')}}/>}
    <div hidden={designed}>{sourceId&&children?children:view?.source?.sections.map(section=><article key={section.id}><h4>{section.title}</h4><ContactMarkdown>{section.body}</ContactMarkdown></article>)??children}</div>
    {Boolean(view?.history?.length)&&<details><summary>界面版本</summary><ul>{view!.history!.map(version=><li key={version.id}>版本 {version.version} · {new Date(version.createdAt).toLocaleString()} {version.id===pinned?.id?<span>正在阅读</span>:<button type="button" onClick={()=>void restore(version.id)}>恢复此界面</button>}</li>)}</ul></details>}
    {dialog&&view?.source&&<ResultDesignDialog task={task} source={view.source.ref} onClose={()=>setDialog(false)} onSaved={()=>setError('')}/>}
  </div>
}
