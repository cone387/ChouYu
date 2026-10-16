import { app, ipcMain, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { TaskCenter } from '../task-center/store'
import { contactAgentsCall } from '../agents'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { waitForRenderer } from './storage-smoke'

export async function runContactHomeSmoke(window: BrowserWindow, owner: string) {
  const run = (code: string) => window.webContents.executeJavaScript(code)
  const click = async (selector: string) => {
    const point = await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Missing home control '+${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point }); window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
  }
  await run(`window.electronAPI.agents.save(${JSON.stringify(owner)},${JSON.stringify({ ...DEFAULT_AGENT_SETTINGS, goal: 'Homepage acceptance', enabled: false })})`)
  const store = new TaskCenter(join(app.getPath('userData'), 'contact-agents', 'agents.db'))
  try {
    const topic = store.topics.create(owner, { title: '海边来信', goal: 'Write a story', constraints: '' }, 'user'), first = store.createRun(owner, '', Date.now(), topic.id)
    store.finish(first, { runId: first, title: '开篇', body: '她沿着海岸往前走，终于看见信中提到的灯塔。', nextStep: 'Continue', evidence: [], createdAt: Date.now() }, [], { status: 'researching', judgement: 'Saved', reason: 'Saved', nextStep: 'Continue', openQuestions: '' })
    const pending = store.createRun(owner, '', Date.now(), topic.id); store.wait(pending, '结尾希望保留悬念，还是让两个人重逢？')
    await click('[data-agent-tab=overview]'); await waitForRenderer(window, "document.querySelector('[data-home-pending]')?.textContent.includes('重逢') && document.querySelector('[data-home-deliveries]')?.textContent.includes('灯塔')")
    if (!await run("(()=>{const e=document.querySelector('[data-contact-home]');return [...e.children].filter(n=>n.dataset.homePending!==undefined||n.dataset.homeDeliveries!==undefined||n.dataset.homeTasks!==undefined).map(n=>Object.keys(n.dataset)[0]).join(',')==='homePending,homeDeliveries,homeTasks'&&!e.querySelector('[data-contact-daily]')})()")) throw new Error('Contact homepage hierarchy is incorrect')
    for (const notice of store.notices.pending(owner)) store.notices.ack(owner, notice.id)
    if (!(await run(`window.electronAPI.agents.contactHome(${JSON.stringify(owner)})`)).pending.length) throw new Error('Reading notices resolved a decision')
    const directory = join(process.cwd(), 'artifacts', 'contact-home'); mkdirSync(directory, { recursive: true })
    const css = await window.webContents.insertCSS('.chat-panel{left:8px!important;top:8px!important;transform:none!important;width:calc(100vw - 16px)!important;height:calc(100vh - 16px)!important;min-width:0!important}.contacts-detail{max-width:100%!important}')
    try {
      for (const theme of ['light', 'dark']) for (const width of [375, 1024]) {
        await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
        window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 900 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, viewSize: { width, height: 900 }, scale: 1 })
        await waitForRenderer(window, `innerWidth===${width}`)
        await run("(()=>{const e=document.querySelector('.contacts-detail'),p=e.offsetParent;Object.assign(e.style,{left:'8px',top:'8px',width:(p.clientWidth-16)+'px',height:(p.clientHeight-16)+'px'});e.scrollTop=0})()")
        await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); await window.webContents.capturePage()
        if (!await run("(()=>{const e=document.querySelector('.contacts-detail');return e.scrollWidth<=e.clientWidth+1})()")) { console.error('HOME_OVERFLOW', await run("(()=>{const e=document.querySelector('.contacts-detail'),r=e.getBoundingClientRect();return {width:e.clientWidth,scroll:e.scrollWidth,children:[...e.querySelectorAll('*')].filter(n=>n.getClientRects().length&&n.getBoundingClientRect().right>r.right).slice(0,25).map(n=>({tag:n.tagName,cls:n.className,width:n.getBoundingClientRect().width}))}})()")); throw new Error('Home detail has horizontal overflow') }
        writeFileSync(join(directory, `${theme}-${width}.png`), (await window.webContents.capturePage({ x: 0, y: 0, width, height: 900 })).toPNG())
      }
    } finally { window.webContents.disableDeviceEmulation(); await window.webContents.removeInsertedCSS(css); await run("document.documentElement.dataset.theme='light'") }
    await click('[data-agent-tab=memory]')
    ipcMain.removeHandler('agents:contactHome'); ipcMain.handle('agents:contactHome', () => { throw new Error('Home read failure fixture') })
    try {
      await click('[data-agent-tab=overview]'); await waitForRenderer(window, "document.querySelector('[data-contact-home] [role=alert]')?.textContent.includes('Home read failure')")
      if (await run("Boolean(document.querySelector('[data-contact-home] [role=status]'))")) throw new Error('Failed home read stayed loading')
    } finally { ipcMain.removeHandler('agents:contactHome'); ipcMain.handle('agents:contactHome', (_event, id: string) => contactAgentsCall(id, 'contactHome')) }
    await click('[data-contact-home] [role=alert] button'); await waitForRenderer(window, "Boolean(document.querySelector('[data-home-deliveries]'))")
    console.log('CHOUYU_CONTACT_HOME_SMOKE_PASSED actual pending/prose/task order, read is unresolved, failure/retry and responsive themes')
  } finally { store.close() }
}
