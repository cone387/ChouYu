import type {IpcRenderer} from 'electron'
import type {ResultDesignAPI} from '../../shared/result-design'
export function createResultDesignBridge(ipc:IpcRenderer):{resultDesign:ResultDesignAPI}{
  return {resultDesign:{get:(task,sourceId)=>ipc.invoke('result-design:get',task,sourceId),request:(task,text,identity,source)=>ipc.invoke('result-design:request',task,text,identity,source),
    retry:task=>ipc.invoke('result-design:retry',task),restore:(task,id)=>ipc.invoke('result-design:restore',task,id),
    onChanged:callback=>{const listener=()=>callback();ipc.on('agents:changed',listener);ipc.on('assistant-routines:changed',listener);return()=>{ipc.removeListener('agents:changed',listener);ipc.removeListener('assistant-routines:changed',listener)}}}}
}
