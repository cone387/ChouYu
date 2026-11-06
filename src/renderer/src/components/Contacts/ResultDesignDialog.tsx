import {useEffect,useId,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import type {ResultTaskRef,ResultSourceRef} from '../../../../shared/result-design'
export default function ResultDesignDialog({task,source,onClose,onSaved}:{task:ResultTaskRef;source:ResultSourceRef;onClose():void;onSaved():void}){
  const dialog=useRef<HTMLDialogElement>(null),title=useId(),identity=useRef({text:'',id:''}),alive=useRef(true),pending=useRef(false)
  const [text,setText]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  useEffect(()=>{alive.current=true;dialog.current?.showModal();return()=>{alive.current=false}},[])
  const save=async()=>{
    if(pending.current)return;pending.current=true;setBusy(true);setError('')
    if(identity.current.text!==text)identity.current={text,id:crypto.randomUUID()}
    try{await window.electronAPI.resultDesign.request(task,text,identity.current.id,source);if(alive.current){onSaved();onClose()}}
    catch(e){if(alive.current)setError(e instanceof Error?e.message:String(e))}
    finally{pending.current=false;if(alive.current)setBusy(false)}
  }
  return createPortal(<dialog className="contact-task-dialog" ref={dialog} aria-labelledby={title} data-interactive data-interactive-bounds
    onKeyDown={e=>{if(e.key==='Escape')e.stopPropagation()}} onCancel={e=>{e.preventDefault();e.stopPropagation();if(!pending.current)onClose()}}>
    <form onSubmit={e=>{e.preventDefault();void save()}} aria-busy={busy}>
      <h3 id={title}>调整成果界面</h3><label htmlFor={`${title}-text`}>展示要求</label>
      <textarea id={`${title}-text`} autoFocus rows={5} maxLength={8000} value={text} disabled={busy} onChange={e=>setText(e.target.value)} placeholder="例如：章节目录放左边，正文像一本书，手机上也方便阅读。"/>
      <p className="agent-caption">界面设计师会读取这项任务的正式成果并制作展示。</p>
      {error&&<p role="alert">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="primary" disabled={busy||!text.trim()}>{busy?'保存中…':'保存'}</button></footer>
    </form>
  </dialog>,document.body)
}
