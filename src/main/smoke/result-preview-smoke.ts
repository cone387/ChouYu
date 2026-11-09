import assert from 'node:assert/strict'
import {BrowserWindow} from 'electron'
import {writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {ElectronDesignPreview} from '../result-designer/preview'
import {sourceSnapshot} from '../../shared/result-design'
import {resultDesignDocument} from '../../shared/result-design-document'
import {designEnvironment} from '../../shared/result-design-environment'

/** Real Chromium regression: valid long Chinese results must not become oversized navigation URLs. */
export async function runResultPreviewSmoke(directory:string){
  const preview=new ElectronDesignPreview(directory),before=new Set(BrowserWindow.getAllWindows())
  const snapshot=sourceSnapshot({domain:'contact',ownerId:'fixture',taskId:'long-result'},'1','长篇成果预览',
    Array.from({length:10},(_,i)=>({id:`part-${i}`,title:`第 ${i+1} 节`,body:'中文成果完整保留。'.repeat(11111),sources:[]})),[])
  const code={title:'长篇成果',html:'<button id="read">阅读最后一节</button>',css:'',
    script:'document.getElementById("read").onclick=()=>document.getElementById("section-part-9").scrollIntoView()'}
  const encodedLength=encodeURIComponent(resultDesignDocument(snapshot,code,designEnvironment(375,'light'),'fixture')).length
  assert.ok(encodedLength>2*1024*1024)
  try{
    for(const width of [375,1024])for(const theme of ['light','dark'] as const){
      const session=await preview.open({jobId:'long',snapshot,code,environment:designEnvironment(width,theme)},new AbortController().signal)
      try{
        const observation=await session.inspect()
        assert.equal(observation.contentIntact,true);assert.equal(observation.contentComplete,true)
        assert.equal(observation.interactionsPassed,true);assert.deepEqual(observation.errors,[])
        const last=await session.act({kind:'click',target:observation.controls[0].id})
        assert.equal(last.contentIntact,true)
        writeFileSync(join(directory,`${theme}-${width}.png`),Buffer.from(last.imageUrl.split(',')[1],'base64'))
        const win=BrowserWindow.getAllWindows().find(w=>!before.has(w))!
        assert.ok(await win.webContents.executeJavaScript("(()=>{const body=document.querySelector('[data-result-body]');return body.clientWidth/parseFloat(getComputedStyle(body).fontSize)<=42.5})()"),'默认中文正文行长不应超过约 42 字')
        assert.ok(await win.webContents.executeJavaScript('scrollY>1000'))
        const middle=await session.act({kind:'scroll',fraction:0.5}),end=await session.act({kind:'scroll',fraction:1})
        assert.ok(end.scroll!.maxY>100000,'验收应覆盖超过绝对滚动上限的长文')
        assert.ok(Math.abs(middle.scroll!.y-middle.scroll!.maxY/2)<2)
        assert.ok(Math.abs(end.scroll!.y-end.scroll!.maxY)<2)
        assert.equal(end.contentIntact,true);assert.deepEqual(end.errors,[])
        writeFileSync(join(directory,`long-end-${theme}-${width}.png`),Buffer.from(end.imageUrl.split(',')[1],'base64'))
        assert.equal(await win.webContents.executeJavaScript('typeof require'), 'undefined')
        assert.equal(await win.webContents.executeJavaScript('typeof window.electronAPI'), 'undefined')
        assert.equal(await win.webContents.executeJavaScript('(()=>{try{localStorage.setItem("probe","1");return false}catch{return true}})()'),true,'preview must retain an opaque sandbox origin')
        for(const target of ['https://example.invalid/probe','file:///preview-must-not-read-local-files',win.webContents.getURL()]){
          assert.equal(await win.webContents.executeJavaScript(`fetch(${JSON.stringify(target)}).then(()=>false,()=>true)`),true,'document must not fetch network, files or its own source')
        }
        const url=win.webContents.getURL()
        await win.webContents.executeJavaScript('location.href="https://example.invalid/escape";undefined')
        assert.equal(win.webContents.getURL(),url,'script navigation must remain blocked')
        const partition=win.webContents.session
        await session.close()
        assert.equal(await partition.protocol.isProtocolHandled('chouyu-result'),false,'closing must remove the session document handler')
        console.log(JSON.stringify({width,theme,encodedLength,sections:observation.reachedSections?.length,urlLength:url.length}))
      }finally{await session.close()}
      assert.equal(BrowserWindow.getAllWindows().length,before.size)
    }
    const abort=new AbortController()
    const cancelled=await preview.open({jobId:'cancel',snapshot,code,environment:designEnvironment(375,'light')},abort.signal)
    abort.abort();await cancelled.close()
    await assert.rejects(cancelled.inspect(),/关闭|abort/i)
    assert.equal(BrowserWindow.getAllWindows().length,before.size)
  }finally{await preview.close()}
}
