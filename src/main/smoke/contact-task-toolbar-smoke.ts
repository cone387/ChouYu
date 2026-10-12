import { app, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { AgentStore } from '../agents/store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { createCharacter, createChatSession, getConfig, listCharacters, saveConfig, selectChatSession } from '../database'
import { waitForRenderer } from './storage-smoke'

export async function runContactTaskToolbarSmoke(window: BrowserWindow) {
  if (process.env.CHOUYU_SMOKE_TEST !== '1') throw new Error('Isolated smoke only')
  const run = (code: string) => window.webContents.executeJavaScript(code)
  const character = createCharacter({ ...listCharacters()[0], name: '任务快捷操作验收', model: 'agent-smoke' })
  const session = createChatSession('任务快捷操作验收', character.id).activeSession.id
  // Start/recover the worker before adding isolated in-flight fixtures.
  await run(`window.electronAPI.agents.get(${JSON.stringify(character.id)})`)
  const directory = join(app.getPath('userData'), 'contact-agents'); mkdirSync(directory, { recursive: true })
  const store = new AgentStore(join(directory, 'agents.db'))
  let first: string, second: string, waiting: string
  try {
    store.save(character.id, { ...DEFAULT_AGENT_SETTINGS, goal: '续写第一项任务', dailyCalls: 100, maxConcurrentTasks: 2 })
    first = store.overview(character.id).topics[0].id
    second = store.topics.create(character.id, { title: '第二项独立任务', goal: '保留另一项任务', constraints: '' }, '隔离验收').id
    const active = store.createRun(character.id, '', Date.now(), first); store.setStatus(active, 'running')
    waiting = store.createRun(character.id, '', Date.now(), second); store.wait(waiting, '第二项面向哪些读者？')
  } finally { store.close() }
  selectChatSession(session); window.webContents.send('characters:changed'); window.webContents.send('sessions:changed'); window.webContents.send('open-chat-panel')
  const root = `[data-contact-current-task="${character.id}"]`
  await waitForRenderer(window, `Boolean(document.querySelector(${JSON.stringify(root + ' [data-current-task-action=pause]')}))`)
  const animation = `getComputedStyle(document.querySelector(${JSON.stringify(root + ' .contact-task-running-arc')})).animationName`
  await waitForRenderer(window, `${animation} === 'none'`)
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  await waitForRenderer(window, `${animation} === 'contact-task-spin'`)
  if (!await run(`(()=>{const el=document.querySelector(${JSON.stringify(root + ' [data-task-status=running]')});return el?.getAttribute('aria-label')==='正在推进'&&getComputedStyle(el.querySelector('.contact-task-running-arc')).animationName==='contact-task-spin'})()`)) throw new Error('Running task lacks an accessible animated status')
  if (process.env.CHOUYU_SMOKE_ARTIFACTS) {
    mkdirSync(process.env.CHOUYU_SMOKE_ARTIFACTS, { recursive: true })
    writeFileSync(join(process.env.CHOUYU_SMOKE_ARTIFACTS, 'task-toolbar-running.png'), (await window.webContents.capturePage()).toPNG())
  }
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await waitForRenderer(window, `${animation} === 'none'`)
  const click = async (selector: string) => {
    await run(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`)
    const point = await run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!el.contains(document.elementFromPoint(x,y)))throw new Error('Control covered');return {x:Math.round(x),y:Math.round(y)}})()`)
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point }); window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
  }
  const failing = new AgentStore(join(directory, 'agents.db'))
  try { failing.db.exec(`CREATE TRIGGER toolbar_write_failure BEFORE UPDATE OF value ON topics WHEN NEW.id='${first}' BEGIN SELECT RAISE(ABORT,'toolbar write failure fixture'); END`) } finally { failing.close() }
  await click(`${root} [data-current-task-action=pause]`)
  await waitForRenderer(window, `document.querySelector(${JSON.stringify(root)})?.textContent.includes('toolbar write failure fixture') && document.querySelector(${JSON.stringify(root)})?.getAttribute('aria-busy')==='false'`)
  const recovered = new AgentStore(join(directory, 'agents.db'))
  try {
    if (recovered.topics.get(character.id, first).status === 'paused') throw new Error('Failed pause falsely persisted')
    recovered.db.exec('DROP TRIGGER toolbar_write_failure')
  } finally { recovered.close() }
  await click(`${root} [data-current-task-action=pause]`)
  await waitForRenderer(window, `Boolean(document.querySelector(${JSON.stringify(root + ' [data-current-task-action=continue]')}))`)
  if (!await run(`Boolean(document.querySelector(${JSON.stringify(root + ' [data-task-status=paused]')})) && !document.querySelector(${JSON.stringify(root + ' .contact-task-running-arc')})`)) throw new Error('Paused task still appears to run')
  let overview = await run(`window.electronAPI.agents.get(${JSON.stringify(character.id)})`)
  if (overview.topics.find((t: { id: string }) => t.id === first).status !== 'paused' || overview.runs.find((r: { id: string }) => r.id === waiting).status !== 'waiting') throw new Error('Pause affected another task or was not saved')
  if (await run(`document.querySelector(${JSON.stringify(root + ' select')}).value`) !== first) throw new Error('Paused task selection changed')
  const changed = new AgentStore(join(directory, 'agents.db'))
  try {
    const topic = changed.topics.get(character.id, first)
    changed.changeTopic(character.id, first, topic.revision, { input: { title: topic.title, goal: topic.goal, constraints: '另一入口刚保存的要求' }, reason: '验证旧按钮不得覆盖新版本' })
  } finally { changed.close() }
  await click(`${root} [data-current-task-action=continue]`)
  await waitForRenderer(window, `document.querySelector(${JSON.stringify(root)})?.textContent.includes('任务状态已变化') && document.querySelector(${JSON.stringify(root)})?.getAttribute('aria-busy')==='false'`)
  await click(`${root} [data-current-task-action=continue]`)
  await waitForRenderer(window, `document.querySelector(${JSON.stringify(root)})?.getAttribute('aria-busy')==='false'`)
  overview = await run(`window.electronAPI.agents.get(${JSON.stringify(character.id)})`)
  if (overview.topics.find((t: { id: string }) => t.id === first).status === 'paused' || overview.runs.filter((r: { topicId: string }) => r.topicId === first).length !== 2) throw new Error('Continue did not queue exactly one round')
  await run(`(()=>{const el=document.querySelector(${JSON.stringify(root + ' select')});el.value=${JSON.stringify(second)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  await waitForRenderer(window, `document.querySelector(${JSON.stringify(root)})?.textContent.includes('回复问题')`)
  if (!await run(`Boolean(document.querySelector(${JSON.stringify(root + ' [data-task-status=waiting]')})) && !document.querySelector(${JSON.stringify(root + ' .contact-task-running-arc')})`)) throw new Error('Waiting question still appears to run')
  await run(`Array.from(document.querySelector(${JSON.stringify(root)}).querySelectorAll('button')).find(b=>b.textContent==='回复问题').click()`)
  await waitForRenderer(window, `document.querySelector('.contact-work-sheet .agent-question')?.textContent.includes('第二项面向哪些读者？')`)
  if (await run("document.querySelector('.contact-work-sheet [data-topic-current]').dataset.topicCurrent") !== second) throw new Error('Reply opened the wrong task')
  await run("document.querySelector('[aria-label=\"关闭联系人工作弹窗\"]').click()")
  // A portal dialog must participate in native click-through routing, not just DOM clicks.
  await click(`[data-contact-pending="${character.id}"]`)
  await waitForRenderer(window, "Boolean(document.querySelector('.contact-pending-dialog[open] textarea'))")
  await run("window.__pendingIgnored=null;window.__stopPendingMouse=window.electronAPI.onMouseEventsState(value=>{window.__pendingIgnored=value});window.electronAPI.setIgnoreMouseEvents(false);window.electronAPI.setIgnoreMouseEvents(true)")
  await waitForRenderer(window, 'window.__pendingIgnored === true')
  try {
    const inputPoint = await run("(()=>{const el=document.querySelector('.contact-pending-dialog textarea'),r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()")
    window.webContents.send('cursor-position', inputPoint)
    await waitForRenderer(window, 'window.__pendingIgnored === false', 3000)
    await click('.contact-pending-dialog textarea')
    if (!await run("document.activeElement===document.querySelector('.contact-pending-dialog textarea')")) throw new Error('Pending input click passed through')
    window.webContents.send('cursor-position', { x: 3, y: 3 })
    await waitForRenderer(window, 'window.__pendingIgnored === true')
    window.webContents.send('cursor-position', inputPoint)
    await waitForRenderer(window, 'window.__pendingIgnored === false')
    await click('[aria-label="关闭待处理事项"]')
    await waitForRenderer(window, "!document.querySelector('.contact-pending-dialog[open]')")
    await waitForRenderer(window, `document.activeElement===document.querySelector('[data-contact-pending="${character.id}"]')`)
    await click(`[data-contact-pending="${character.id}"]`)
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-pending-dialog[open]'))")
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await waitForRenderer(window, "!document.querySelector('.contact-pending-dialog[open]')")
    // Shared Escape handling deliberately clears restored button focus after dismissal.
    if (!await run(`document.querySelector('[data-contact-pending="${character.id}"]').getBoundingClientRect().width>0`)) throw new Error('Escape closed the underlying chat')
  } finally { await run('window.__stopPendingMouse();delete window.__stopPendingMouse') }
  console.log('CHOUYU_PENDING_POINTER_PASSED input=true close=true escape=true nativeMouseState=true bounded=true')
  const artifacts = process.env.CHOUYU_SMOKE_ARTIFACTS
  if (artifacts) {
    mkdirSync(artifacts, { recursive: true })
    await run("document.querySelector('[aria-label=\"窗口模式\"]').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('[data-workspace-mode-option=chat]'))")
    await run("document.querySelector('[data-workspace-mode-option=chat]').click()")
    for (const theme of ['light', 'dark'] as const) {
      saveConfig({ theme }); window.webContents.send('config:changed', getConfig())
      for (const width of [375, 1024]) {
        window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 900 }, viewPosition: { x: 0, y: 0 }, viewSize: { width, height: 900 }, deviceScaleFactor: 1, scale: 1 })
        await run('new Promise(resolve=>setTimeout(resolve,250))')
        await run(`Object.assign(document.querySelector('.chat-panel').style,{left:'8px',top:'8px',width:'${width - 16}px',height:'880px',transform:'none'})`)
        await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        if (!await run(`(()=>{const el=document.querySelector(${JSON.stringify(root)}),r=el.getBoundingClientRect(),select=el.querySelector('select');select.focus();const style=getComputedStyle(select);return el.parentElement.getAttribute('aria-label')==='联系人快捷工具'&&r.height<=31&&r.left>=0&&r.right<=innerWidth+1&&el.scrollWidth<=el.clientWidth+1&&style.outlineStyle==='none'&&style.boxShadow==='none'&&style.borderTopWidth==='0px'})()`)) throw new Error('Task controls must stay inline without overflow or decorated input focus')
        writeFileSync(join(artifacts, `task-toolbar-${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG())
      }
    }
    window.webContents.disableDeviceEmulation()
  }
  const other = createCharacter({ ...listCharacters()[0], name: '其他联系人', model: 'agent-smoke' })
  const otherSession = createChatSession('其他联系人', other.id).activeSession.id
  selectChatSession(otherSession); window.webContents.send('characters:changed'); window.webContents.send('sessions:changed')
  await waitForRenderer(window, `Boolean(document.querySelector('[data-contact-work-tools="${other.id}"]')) && !document.querySelector(${JSON.stringify(root)})`)
  if (await run(`Boolean(document.querySelector('[data-contact-current-task="${other.id}"] [data-current-task-action]'))`)) throw new Error('Other contact inherited current task')
  console.log('CHOUYU_TASK_TOOLBAR_PASSED singlePause=true stableSelection=true continueOnce=true originalQuestion=true persisted=true staleGuard=true rollback=true contactIsolation=true statusIcon=true reducedMotion=true')
}
