import { app, protocol, type BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { registerPresentationProtocol } from '../agents/presentation-protocol'
import type { AgentDelivery } from '../../shared/agent-delivery'
import { deliveryHtmlExport } from '../../shared/delivery-presentation'

/** Isolated browser integration; no provider calls or access to real user data. */
export async function runDeliveryPresentationSmoke(window: BrowserWindow) {
  const artifact: AgentDelivery = {
    version: 1, runId: 'fixture', createdAt: 1, completionCriteria: '完成短篇', stages: [{ id: 'draft', title: '初稿', status: 'active' }], summary: '初稿开篇',
    sections: [{ id: 'chapter1', title: '第一章 · 雨停之前', body: '雨从傍晚开始下。林音合上书，听见窗外有人轻轻叩门。\n\n她没有立刻起身。那本书的最后一页，原本是一张空白的纸。现在，上面多了一行字：请在雨停之前回来。', runId: 'fixture' }, { id: 'chapter2', title: '第二章 · 回声', body: '她走进长廊，灯一盏接一盏亮起来。\n\n</script><script>parent.attack()</script>', runId: 'fixture' }],
    presentation: { title: '静读', html: '<header><p>林音的故事</p></header><div id="content"></div>', css: 'header{border-bottom:1px solid #888}header p{font-size:14px}h1{font-weight:500}h2{margin-top:2.5em}.body{line-height:2.2}button{padding:6px 12px;border:1px solid #888;background:transparent;color:inherit;border-radius:4px}', script: "document.body.dataset.custom='rendered';const button=document.createElement('button');button.textContent='大字阅读';button.onclick=()=>document.body.style.fontSize='20px';document.getElementById('root').prepend(button)" }
  }
  protocol.unhandle('chouyu-artifact')
  registerPresentationProtocol(async (id, topic, version) => {
    if (id !== 'writer' || topic !== 'story' || version !== 1) throw new Error('Missing fixture')
    return { title: '雨停之前', artifact }
  })
  const url = 'chouyu-artifact://view/writer/story/1'
  const run = (code: string) => window.webContents.executeJavaScript(code)
  await run(`document.body.innerHTML='';document.body.style.cssText='margin:0;background:white';new Promise((resolve,reject)=>{const frame=document.createElement('iframe');frame.id='preview';frame.title='作家成果';frame.style.cssText='border:0;width:100vw;height:100vh';frame.sandbox='allow-scripts';frame.src=${JSON.stringify(url)};const timeout=setTimeout(()=>reject(new Error('Presentation did not execute')),8000);const listener=e=>{if(e.source===frame.contentWindow&&e.data?.type==='delivery-preview'){clearTimeout(timeout);window.removeEventListener('message',listener);e.data.state==='ready'?resolve(true):reject(new Error('Presentation script failed'))}};window.addEventListener('message',listener);document.body.append(frame)})`)
  const frame = window.webContents.mainFrame.frames.find(f => f.url === url)
  if (!frame) throw new Error('Presentation frame missing')
  const isolation = await frame.executeJavaScript(`(async()=>{let parentBlocked=false,networkBlocked=false;try{parent.document.body}catch{parentBlocked=true}try{await fetch('https://example.com/')}catch{networkBlocked=true}document.querySelector('button').click();return {parentBlocked,networkBlocked,bridge:typeof window.electronAPI,node:typeof require,custom:document.body.dataset.custom,font:document.body.style.fontSize,text:document.getElementById('content').textContent}})()`) as Record<string, unknown>
  if (!isolation.parentBlocked || !isolation.networkBlocked || isolation.bridge !== 'undefined' || isolation.node !== 'undefined' || isolation.custom !== 'rendered' || isolation.font !== '20px' || !String(isolation.text).includes('</script><script>')) throw new Error(`Presentation isolation failed: ${JSON.stringify(isolation)}`)
  await frame.executeJavaScript("location.href='chouyu-artifact://view/writer/story/2'")
  await new Promise(resolve => setTimeout(resolve, 100))
  if (frame.url !== url) throw new Error('Presentation escaped by navigating')
  if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach('1.3')
  try {
    for (const width of [375, 1024]) for (const theme of ['light', 'dark']) {
      window.setContentSize(width, 900)
      await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] })
      await new Promise(resolve => setTimeout(resolve, 120))
      if (!await frame.executeJavaScript('document.documentElement.scrollWidth <= innerWidth')) throw new Error('Presentation overflows at ' + width)
      const directory = process.env.CHOUYU_SMOKE_ARTIFACTS
      if (directory) { mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, `reading-${theme}-${width}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()) }
    }
    artifact.presentation!.script = 'throw new Error("broken view")'
    await run(`new Promise((resolve,reject)=>{const old=document.getElementById('preview');old.remove();const frame=document.createElement('iframe');frame.sandbox='allow-scripts';frame.src=${JSON.stringify(url)};const timeout=setTimeout(()=>reject(new Error('Missing fallback signal')),5000);window.addEventListener('message',e=>{if(e.source===frame.contentWindow&&e.data?.state==='error'){clearTimeout(timeout);resolve(true)}});document.body.append(frame)})`)
  } finally { window.webContents.debugger.detach() }
  artifact.presentation!.script = "document.body.dataset.custom='exported'"
  const exported = join(app.getPath('userData'), 'reading.html')
  writeFileSync(exported, deliveryHtmlExport('雨停之前', artifact, 'export-smoke'), 'utf8')
  await window.loadFile(exported)
  const exportFrame = window.webContents.mainFrame.frames.find(f => f.url === 'about:srcdoc')
  if (!exportFrame || !await exportFrame.executeJavaScript("document.body.dataset.custom==='exported' && document.getElementById('content').textContent.includes('林音')")) throw new Error('Exported reading page did not render')
  console.log('CHOUYU_SMOKE_PRESENTATION isolated-render-responsive-fallback-ok')
}
