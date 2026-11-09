import {screen,type BrowserWindow} from 'electron'
import {waitForRenderer} from './storage-smoke'

/** Hold the native pointer fixed; no synthetic mouse/cursor event after setup. */
export async function runStationaryPointerSmoke(window:BrowserWindow){
  const read=screen.getCursorScreenPoint,bounds=window.getContentBounds()
  const run=(code:string)=>window.webContents.executeJavaScript(code)
  try{
    screen.getCursorScreenPoint=()=>({x:bounds.x+10,y:bounds.y+10})
    await run("window.__stationaryIgnored=null;window.__stopStationary=window.electronAPI.onMouseEventsState(value=>window.__stationaryIgnored=value);window.electronAPI.setIgnoreMouseEvents(false);window.electronAPI.setIgnoreMouseEvents(true)")
    window.webContents.send('cursor-position',{x:10,y:10})
    await waitForRenderer(window,'window.__stationaryIgnored===true')
    // Allow the native poll to cache this same coordinate before changing DOM.
    await new Promise(resolve=>setTimeout(resolve,160))
    await run("window.__stationaryDialog=document.createElement('dialog');Object.assign(window.__stationaryDialog.style,{position:'fixed',margin:'0',left:'0',top:'0',width:'100px',height:'100px',padding:'0'});window.__stationaryDialog.dataset.interactive='';window.__stationaryDialog.dataset.interactiveBounds='';document.body.append(window.__stationaryDialog);window.__stationaryDialog.showModal()")
    await waitForRenderer(window,'window.__stationaryIgnored===false')
    await run("window.__stationaryDialog.style.left='200px'")
    await waitForRenderer(window,'window.__stationaryIgnored===true')
    await run("window.__stationaryDialog.style.left='0'")
    await waitForRenderer(window,'window.__stationaryIgnored===false')
    await run('window.__stationaryDialog.close()')
    await waitForRenderer(window,'window.__stationaryIgnored===true')
    // File dragging must retain capture through unrelated DOM invalidation.
    await run("document.dispatchEvent(new Event('dragenter'));window.__stationaryDialog.style.left='100px'")
    await waitForRenderer(window,'window.__stationaryIgnored===false')
    await new Promise(resolve=>setTimeout(resolve,80))
    await waitForRenderer(window,'window.__stationaryIgnored===false')
    await run("document.dispatchEvent(new Event('drop'))")
    await waitForRenderer(window,'window.__stationaryIgnored===true')
    console.log('CHOUYU_STATIONARY_POINTER_PASSED modal open, bounds change, close, external drag')
  }finally{
    screen.getCursorScreenPoint=read
    await run("window.__stationaryDialog?.remove();window.__stopStationary?.();delete window.__stationaryDialog;delete window.__stopStationary;delete window.__stationaryIgnored")
  }
}
