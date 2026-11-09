import assert from 'node:assert/strict'
import {app,BrowserWindow} from 'electron'
import {createServer} from 'node:http'
import {join} from 'node:path'
import {mkdirSync,writeFileSync} from 'node:fs'
import {ContactTaskStore} from '../task-center/contact-store'
import {ContactResultSources} from '../result-designer/sources'
import {ElectronDesignPreview} from '../result-designer/preview'
import {createDesignModel} from '../result-designer/model'
import {DesignBudget,createDesignRun} from '../result-designer/budget'
import {runResultDesign} from '../result-designer/workflow'
import {createBackgroundHarnesses} from '../harness/background'
import {RESULT_DESIGNER_CHARACTER_ID as designer} from '../../shared/result-design'
import {createCharacter,createChatSession,listCharacters,getConfig,saveConfig,selectChatSession,getSessions,getSession,getActiveSession} from '../database'
import {restartAgentsForSmoke,contactAgentsCall} from '../agents'
import {waitForRenderer} from './storage-smoke'
import {sourceSnapshot} from '../../shared/result-design'
import {designEnvironment} from '../../shared/result-design-environment'
import {runResultPreviewSmoke} from './result-preview-smoke'

/** Real Electron images and Native provider protocol, isolated local fixtures only. */
export async function runResultDesignerSmoke(window:BrowserWindow){
  const directory=process.env.CHOUYU_SMOKE_ARTIFACTS?join(process.env.CHOUYU_SMOKE_ARTIFACTS,'result-designer'):join(app.getPath('userData'),'result-designer-acceptance')
  mkdirSync(directory,{recursive:true})
  await runResultPreviewSmoke(directory)
  const store=new ContactTaskStore(join(directory,'fixture.db')),preview=new ElectronDesignPreview(directory)
  let screenshots=0,calls=0,code={title:'',html:'',css:'',script:''}
  const server=createServer((request,response)=>{
    let input='';request.on('data',chunk=>input+=chunk);request.on('end',()=>{
      try{
        const payload=JSON.parse(input),images=payload.messages.flatMap((m:any)=>Array.isArray(m.content)?m.content.filter((p:any)=>p.type==='image_url'):[])
        calls++;screenshots+=images.length
        for(const image of images)assert.ok(image.image_url.url.startsWith('data:image/png;base64,'))
        const text=payload.messages.some((m:any)=>m.role==='system'&&m.content.includes('视觉验收员'))?JSON.stringify({accepted:true,feedback:'实际截图显示正文与目录完整，四种环境清晰可读。'}):JSON.stringify(code)
        response.writeHead(200,{'Content-Type':'text/event-stream'})
        response.end(`data: ${JSON.stringify({id:`design-fixture-${calls}`,model:'vision-fixture',choices:[{delta:{content:text},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}})}\n\ndata: [DONE]\n\n`)
      }catch(error){response.writeHead(500);response.end(String(error))}
    })
  })
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const port=(server.address() as {port:number}).port
  const report:unknown[]=[]
  try{
    const fixtureSource=sourceSnapshot({domain:'contact',ownerId:'preview',taskId:'fixture'},'1','Preview',[{id:'one',title:'One',body:'First complete section',sources:[]},{id:'two',title:'Two',body:'Second complete section',sources:[]}],[])
    const count=BrowserWindow.getAllWindows().length
    const folded=await preview.open({jobId:'folded',snapshot:fixtureSource,code:{title:'Chapters',html:'<button id="next">Next chapter</button><section data-result-section="one"></section><section data-result-section="two" hidden></section>',css:'',script:'document.getElementById("next").onclick=()=>{for(const section of document.querySelectorAll("section"))section.hidden=!section.hidden}'},environment:designEnvironment(375,'light')},new AbortController().signal)
    try{
      const first=await folded.inspect();assert.equal(first.contentIntact,true);assert.deepEqual(first.reachedSections,['one'])
      const next=await folded.act({kind:'click',target:first.controls[0].id});assert.equal(next.contentIntact,true);assert.deepEqual(next.reachedSections,['two'])
    }finally{await folded.close()}
    const broken=await preview.open({jobId:'error',snapshot:fixtureSource,code:{title:'Error',html:'',css:'',script:'throw Error("intentional fixture error")'},environment:designEnvironment(375,'light')},new AbortController().signal)
    try{assert.ok((await broken.inspect()).errors.some(e=>e.includes('intentional fixture error')))}finally{await broken.close()}
    const hidden=await preview.open({jobId:'hidden',snapshot:fixtureSource,code:{title:'Hidden',html:'',css:'.result-body{color:transparent}',script:''},environment:designEnvironment(375,'light')},new AbortController().signal)
    try{const observation=await hidden.inspect();assert.equal(observation.contentIntact,true);assert.equal(observation.contentComplete,false);assert.deepEqual(observation.reachedSections,[])}finally{await hidden.close()}
    await assert.rejects(preview.open({jobId:'loop',snapshot:fixtureSource,code:{title:'Loop',html:'',css:'',script:'while(true){}'},environment:designEnvironment(375,'light')},new AbortController().signal),/超时|closed|destroyed/)
    assert.equal(BrowserWindow.getAllWindows().length,count)
    store.ensure(designer);store.db.prepare("UPDATE profiles SET settings=json_set(settings,'$.dailyCalls',100,'$.enabled',1) WHERE character_id=?").run(designer)
    for(const [kind,title,body] of [
      ['novel','雨停之前','雨从傍晚开始下。林音合上书，听见窗外有人轻轻叩门。\n\n她翻开最后一页，上面写着：请在雨停之前回来。'],
      ['research','访谈研究','结论：团队管理员需要权限审计。\n证据：六次访谈中四次提及记录追踪；样本有限，仍需验证。'],
      ['ideas','三个产品想法','阅读进度书签：帮助长篇读者回到上次位置。\n研究资料对照：并列核对结论与证据。\n评审意见收件箱：按来源整理待处理意见。'],
      ['review','评审结论','结论：建议修改后采用。\n依据：目标明确，但缺少边界条件与失败处理。\n建议：补齐两个失败场景，保留原有主流程。']]){
      store.ensure('author')
      const content=kind==='novel'?Array.from({length:160},(_,index)=>`${index+1}. ${body}`).join('\n\n'):body
      const topic=store.topics.create('author',{title,goal:title,constraints:''}),run=store.createRun('author','',Date.now(),topic.id)
      store.finish(run,{runId:run,title,body:content,nextStep:'继续',evidence:[],createdAt:Date.now()},[],{status:'researching',judgement:'已保存',reason:'正式交付',nextStep:'继续',openQuestions:''})
      const source=new ContactResultSources(store),snapshot=(await source.latest({domain:'contact',ownerId:'author',taskId:topic.id},new AbortController().signal))!
      const before=JSON.stringify(store.deliveries.get(topic.id)),state=JSON.stringify(store.topics.get('author',topic.id))
      code={title,html:`<header><h1>${title}</h1><button id="read">开始阅读</button></header><section data-result-section="${snapshot.sections[0].id}"></section>`,
        css:'header{padding:24px 0 32px;border-bottom:1px solid var(--line)}h1{font-size:30px;letter-spacing:.02em}main{max-width:720px}section{margin:32px 0}button{padding:8px 16px;border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:5px}',
        script:`document.getElementById('read').onclick=()=>document.querySelector('[data-result-section]').scrollIntoView()`}
      const designRun=createDesignRun(store),job=store.designs.claim(store.designs.pending().find(p=>p.task.taskId===topic.id)!.requestId,designRun)
      const model=createDesignModel({id:designer,soul:'设计师',conversation:'',config:{provider:'openai',baseUrl:`http://127.0.0.1:${port}/v1`,apiKey:'isolated-fixture',model:'vision-fixture',thinkingDisabledModels:[]}},createBackgroundHarnesses(),new DesignBudget(store,designRun),async()=>{store.assertLive(designRun)})
      await runResultDesign(job,{store:store.designs,source,model,preview},AbortSignal.timeout(90000))
      assert.equal(JSON.stringify(store.deliveries.get(topic.id)),before);assert.equal(JSON.stringify(store.topics.get('author',topic.id)),state)
      const active=store.designs.view(snapshot.ref).active;assert.ok(active?.evidence);assert.equal(active.evidence.observations.length,4)
      if(kind==='novel')assert.ok(active.evidence.observations.every(o=>o.readingSamples?.length===2),'长文四种环境均须提供中段与末尾实图')
      report.push({kind,design:active.id,evidence:active.evidence})
    }
    const readingScreens=(report as {evidence:{observations:{readingSamples?:unknown[]}[]}}[]).reduce((sum,row)=>sum+row.evidence.observations.reduce((n,o)=>n+(o.readingSamples?.length??0),0),0)
    assert.equal(screenshots,20+readingScreens);assert.equal(calls,8);assert.ok(store.tokens.usage(designer).today>0)
    const original=getConfig(),originalSession=getActiveSession().id,author=createCharacter({...listCharacters()[0],name:'设计师隔离验收作者',model:'vision-fixture'})
    const chat=createChatSession('成果界面验收',author.id).activeSession.id
    const task={domain:'contact' as const,ownerId:author.id,taskId:''}
    try{
      saveConfig({...original,provider:'openai',baseUrl:`http://127.0.0.1:${port}/v1`,apiKey:'isolated-fixture',model:'vision-fixture'})
      await restartAgentsForSmoke(()=>{
        const fixture=new ContactTaskStore(join(app.getPath('userData'),'contact-agents','agents.db'))
        try{
          fixture.ensure(author.id);fixture.ensure(designer)
          fixture.db.prepare("UPDATE profiles SET settings=json_set(settings,'$.dailyCalls',100,'$.enabled',1,'$.readContactDeliveries',1) WHERE character_id=?").run(designer)
          const topic=fixture.topics.create(author.id,{title:'真实进程成果展示',goal:'阅读保存正文',constraints:''}),run=fixture.createRun(author.id,'',Date.now(),topic.id)
          fixture.finish(run,{runId:run,title:'正式成果',body:Array.from({length:36},(_,i)=>`第${i+1}段：这份正式正文经过独立设计师的真实工作进程、预览窗口和消息通道。长文阅读应沿同一个滚动区域连续进行，不能在正文边缘卡住。`).join('\n\n'),nextStep:'继续',evidence:[],createdAt:Date.now()},[],{status:'researching',judgement:'已保存',reason:'正式交付',nextStep:'继续',openQuestions:''})
          task.taskId=topic.id
          const section=fixture.deliveries.get(topic.id)!.sections[0]
          code={title:topic.title,html:`<h1>成果阅读</h1><section data-result-section="${section.id}"></section>`,css:'main{max-width:720px}h1{font-size:32px}',script:''}
        }finally{fixture.close()}
      })
      selectChatSession(chat);window.webContents.send('characters:changed');window.webContents.send('sessions:changed');window.webContents.send('open-chat-panel')
      const expression=`window.electronAPI.resultDesign.get(${JSON.stringify(task)})`
      await waitForRenderer(window,`(async()=>Boolean((await ${expression}).active))()`,60000)
      const active=await window.webContents.executeJavaScript(expression)
      assert.ok(active.active.evidence);assert.equal(calls,10);assert.equal(screenshots,25+readingScreens+active.active.evidence.observations.reduce((n:number,o:{readingSamples?:unknown[]})=>n+(o.readingSamples?.length??0),0))
      const navigation=`new Promise((resolve,reject)=>window.dispatchEvent(new CustomEvent('chouyu:contact-navigation',{detail:{target:{kind:'task',characterId:${JSON.stringify(author.id)},topicId:${JSON.stringify(task.taskId)}},handled:false,resolve,reject}})))`
      await window.webContents.executeJavaScript("window.__resultReady=false;window.addEventListener('message',event=>{if(event.data?.type==='result-design-ready')window.__resultReady=true})")
      await window.webContents.executeJavaScript(navigation)
      await waitForRenderer(window,"[...document.querySelectorAll('button')].some(b=>b.textContent==='任务成果')")
      await window.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent==='任务成果').click()")
      await waitForRenderer(window,"Boolean(document.querySelector('[data-result-design-view] iframe'))")
      await waitForRenderer(window,'window.__resultReady===true')
      await waitForRenderer(window,"document.querySelector('[data-result-design-view] iframe')?.clientHeight>1000")
      const embedded=window.webContents.mainFrame.frames.find(frame=>frame.url.startsWith('chouyu-result:'))!
      assert.ok(embedded,'正式隔离阅读页已加载')
      await embedded.executeJavaScript("new Promise((resolve,reject)=>{const start=performance.now();const check=()=>{if(document.documentElement.scrollHeight<=innerHeight+1)return resolve(true);if(performance.now()-start>3000)return reject(Error('Frame size '+JSON.stringify({scroll:document.documentElement.scrollHeight,height:innerHeight,body:document.body.getBoundingClientRect().height,root:document.querySelector('main').getBoundingClientRect().height})));requestAnimationFrame(check)};check()})")
      assert.ok(await window.webContents.executeJavaScript("!document.querySelector('[data-result-design-view] [role=alert]')"))
      await window.webContents.executeJavaScript("document.querySelector('[data-result-design-view]').scrollIntoView({block:'start'})")
      writeFileSync(join(directory,'production-reader.png'),(await window.webContents.capturePage()).toPNG())
      await window.webContents.executeJavaScript("[...document.querySelectorAll('[data-result-design-view] button')].find(b=>b.textContent==='原文').click()")
      assert.ok(await window.webContents.executeJavaScript("document.querySelector('[data-result-design-view]').textContent.includes('真实工作进程')"))
      assert.ok(await window.webContents.executeJavaScript("(()=>{const body=document.querySelector('.delivery-reader');return body.scrollHeight<=body.clientHeight+1})()"),'正文不应在任务详情内再建立纵向滚动框')
      assert.ok(await window.webContents.executeJavaScript("(()=>{const detail=document.querySelector('[data-topic-view=delivery]');return detail.querySelector('.topic-floating-action').getBoundingClientRect().bottom<=detail.querySelector('.topic-content-scroll').getBoundingClientRect().top+1})()"),'固定操作栏不能遮挡正在滚动的正文')
      const scrollPoint=await window.webContents.executeJavaScript("(()=>{const body=document.querySelector('.delivery-reader'),pane=body.closest('.topic-content-scroll');pane.scrollTop=body.getBoundingClientRect().top-pane.getBoundingClientRect().top+pane.scrollTop;const r=pane.getBoundingClientRect();window.__readerScroll=pane;window.__readerStart=pane.scrollTop;return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()")
      await window.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
      window.webContents.sendInputEvent({type:'mouseMove',...scrollPoint})
      window.webContents.sendInputEvent({type:'mouseWheel',deltaX:0,deltaY:-500,...scrollPoint})
      await waitForRenderer(window,'window.__readerScroll.scrollTop>window.__readerStart+100')
      await waitForRenderer(window,`(async()=>{const saved=await window.electronAPI.agents.deliveryReading(${JSON.stringify(author.id)},${JSON.stringify(task.taskId)});return saved?.scrollRatio>0})()`)
      const beforeTab=await window.webContents.executeJavaScript('window.__readerScroll.scrollTop')
      await window.webContents.executeJavaScript("[...document.querySelectorAll('button[role=tab]')].find(b=>b.textContent==='概览').click()")
      await window.webContents.executeJavaScript("[...document.querySelectorAll('button[role=tab]')].find(b=>b.textContent==='任务成果').click()")
      await waitForRenderer(window,`Math.abs(window.__readerScroll.scrollTop-${beforeTab})<3`)
      writeFileSync(join(directory,'single-scroll-prose.png'),(await window.webContents.capturePage()).toPNG())
      // Embedded-only guard rails must work even for previously published code.
      const openDesigned=async()=>{
        await window.webContents.executeJavaScript('window.__resultReady=false')
        await window.webContents.executeJavaScript("[...document.querySelectorAll('[data-result-design-view] button')].find(b=>b.textContent==='成果界面').click()")
        await waitForRenderer(window,'window.__resultReady===true')
        await waitForRenderer(window,"document.querySelector('[data-result-design-view] iframe')?.clientHeight>1000")
        return window.webContents.mainFrame.frames.find(frame=>frame.url.startsWith('chouyu-result:'))!
      }
      const fixed=await openDesigned()
      // Focus the native host before its child document. Focusing WebContents
      // afterwards resets Chromium's focusedFrame to the main frame.
      window.show();window.focus();window.webContents.focus()
      await fixed.executeJavaScript("window.__keys=[];addEventListener('keydown',e=>window.__keys.push(e.key));document.body.tabIndex=0;document.body.focus()")
      const focusPoint=await window.webContents.executeJavaScript("(()=>{const iframe=document.querySelector('[data-result-design-view] iframe');iframe.scrollIntoView({block:'start'});const r=iframe.closest('.topic-content-scroll').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()")
      await window.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
      // Smoke startup deliberately leaves this window hidden. Native keyboard
      // injection requires a shown, focused host, unlike capturePage/DOM focus.
      window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...focusPoint});window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...focusPoint})
      await waitForRenderer(window,"document.hasFocus()&&document.activeElement?.tagName==='IFRAME'")
      await fixed.executeJavaScript('document.body.blur();document.body.focus()')
      const focusDeadline=Date.now()+2000
      while(window.webContents.focusedFrame?.routingId!==fixed.routingId&&Date.now()<focusDeadline)await new Promise(resolve=>setTimeout(resolve,20))
      assert.ok(window.isFocused(),'键盘验收前原生窗口必须可见且获得焦点')
      assert.equal(window.webContents.focusedFrame?.routingId,fixed.routingId,'键盘验收必须实际聚焦隔离阅读文档')
      // Chromium routes CDP keyboard input to the focused cross-process frame;
      // WebContents.sendInputEvent targets the main widget on this Electron build.
      const attached=window.webContents.debugger.isAttached();if(!attached)window.webContents.debugger.attach('1.3')
      const press=async(key:string,windowsVirtualKeyCode:number)=>{for(const type of ['keyDown','keyUp'])await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode})}
      await press('Home',36)
      await waitForRenderer(window,'window.__readerScroll.scrollTop===0')
      await press('PageDown',34)
      await waitForRenderer(window,'window.__readerScroll.scrollTop>100').catch(async error=>{console.error('FRAME_KEY_CHECK',await fixed.executeJavaScript('({keys:window.__keys,active:document.activeElement?.tagName})'),await window.webContents.executeJavaScript('({active:document.activeElement?.tagName,top:window.__readerScroll.scrollTop,height:window.__readerScroll.clientHeight,scrollHeight:window.__readerScroll.scrollHeight})'));throw error})
      assert.deepEqual(await fixed.executeJavaScript("window.__keys.filter(key=>key==='Home'||key==='PageDown')"),['Home','PageDown'],'两个翻页按键都必须到达隔离正文')
      if(!attached)window.webContents.debugger.detach()
      await fixed.executeJavaScript("document.querySelector('main').animate([{paddingBottom:'0px'},{paddingBottom:'80px'}],{duration:600}).finished")
      assert.ok(await window.webContents.executeJavaScript("Boolean(document.querySelector('[data-result-design-view] iframe'))"),'正常有限动画不应被当成尺寸循环')
      await fixed.executeJavaScript("(()=>{const box=document.createElement('div');box.id='nested-scroll-fixture';box.style.cssText='height:120px;overflow:hidden';box.innerHTML='<div style=\"height:300px\">嵌套滚动夹具</div>';document.querySelector('main').append(box);return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()")
      await fixed.executeJavaScript("document.getElementById('nested-scroll-fixture').style.overflow='auto'")
      await waitForRenderer(window,"!document.querySelector('[data-result-design-view] iframe')&&Boolean(document.querySelector('[data-result-design-view] [role=alert]'))")
      const growing=await openDesigned()
      await growing.executeJavaScript("document.querySelector('main').style.minHeight='100vh'")
      await waitForRenderer(window,"!document.querySelector('[data-result-design-view] iframe')&&Boolean(document.querySelector('[data-result-design-view] [role=alert]'))")
      await openDesigned()
      await window.webContents.executeJavaScript("[...document.querySelectorAll('[data-result-design-view] button')].find(b=>b.textContent==='调整界面').click()")
      await waitForRenderer(window,"Boolean(document.querySelector('dialog[open] textarea'))")
      window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'})
      await waitForRenderer(window,"![...document.querySelectorAll('dialog[open] h3')].some(el=>el.textContent==='调整成果界面')")
      const notices=await contactAgentsCall(designer,'designNotices')
      // Delivery is durable and may already have been acknowledged by the main outbox.
      assert.ok(notices.length<=1)
      await waitForRenderer(window,`(async()=>Boolean((await window.electronAPI.resultDesign.get(${JSON.stringify(task)})).active))()`)
      const messages=getSessions().filter(s=>s.characterId===designer).flatMap(s=>getSession(s.id)?.messages??[]).filter(m=>m.id===`result-design:${active.active.id}`)
      assert.equal(messages.length,1)
      report.push({kind:'worker-main-renderer',design:active.active.id,notification:messages[0].id})
    }finally{saveConfig(original);selectChatSession(originalSession);window.webContents.send('sessions:changed')}
    writeFileSync(join(directory,'acceptance.json'),JSON.stringify({calls,screenshots,report},null,2))
    console.log('CHOUYU_RESULT_DESIGNER_SMOKE',JSON.stringify({directory,calls,screenshots}))
  }catch(error){console.error('CHOUYU_RESULT_DESIGNER_ERROR',error);throw error}
  finally{await preview.close();store.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}
}
