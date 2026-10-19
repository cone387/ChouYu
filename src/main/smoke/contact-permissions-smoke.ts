import { app, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { ContactTaskStore } from '../task-center/contact-store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { appendAgentNotice, createCharacter, createChatSession, getConfig, listCharacters, saveConfig, selectChatSession } from '../database'
import { waitForRenderer } from './storage-smoke'
import { invokeContactChat } from './contact-card-helper'

/** Isolated database, real renderer controls, IPC confirmation and local model fixture. */
export async function runContactPermissionsSmoke(window: BrowserWindow) {
  if (process.env.CHOUYU_SMOKE_TEST !== '1') throw new Error('Isolated smoke only')
  const run = (code: string) => window.webContents.executeJavaScript(code)
  const template = listCharacters().find(c => !c.builtIn) || listCharacters()[0]
  const character = createCharacter({ ...template, name: '权限与故障处理验收', model: 'agent-smoke' })
  const session = createChatSession('权限与故障处理验收', character.id).activeSession.id
  const directory = join(app.getPath('userData'), 'contact-agents'); mkdirSync(directory, { recursive: true })
  const store = new ContactTaskStore(join(directory, 'agents.db'))
  let topicId: string
  try { store.save(character.id, { ...DEFAULT_AGENT_SETTINGS, goal: '写一篇介绍', dailyCalls: 100, permissionLevel: 'sources', sources: ['https://example.com/'] }); topicId = store.overview(character.id).topics[0].id }
  finally { store.close() }
  selectChatSession(session); window.webContents.send('characters:changed'); window.webContents.send('sessions:changed'); window.webContents.send('open-chat-panel')
  await waitForRenderer(window, "Boolean(document.querySelector('.chat-panel[data-ready=true]'))")
  await run(`window.electronAPI.agents.get(${JSON.stringify(character.id)})`)
  await run(`new Promise((resolve,reject)=>{const detail={target:{kind:'contact-settings',characterId:${JSON.stringify(character.id)},tab:'settings'},handled:false,resolve,reject};window.dispatchEvent(new CustomEvent('chouyu:contact-navigation',{detail}));})`)
  await waitForRenderer(window, "Boolean(document.querySelector('[data-contact-tool-policy] select'))", 15000)
  const choose = async (mode: string) => {
    await run(`(()=>{const el=document.querySelector('[data-contact-tool-policy] select');el.value=${JSON.stringify(mode)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`)
    await waitForRenderer(window, "document.querySelector('.work-settings-flat')?.getAttribute('aria-busy')==='false'")
    const current = await run(`window.electronAPI.agents.get(${JSON.stringify(character.id)})`)
    if (current.settings.toolPermissionMode !== mode) throw new Error(`Permission was not saved: ${mode}`)
  }
  const invoke = async (mode: string, disabled = false) => {
    const request = { requestId: `permission-${mode}-${disabled}`, sessionId: session, characterId: character.id, messages: [{ role: 'user', content: '验收联系人权限：暂停这项任务' }], systemPrompt: '权限验收' }
    return invokeContactChat(window, { ...request, messages: request.messages as import('../../shared/ai').AIChatMessage[] }, false)
  }
  for (const mode of ['full', 'auto', 'confirm', 'inherit']) {
    await choose(mode)
    const result = await invoke(mode)
    if (!result.response.ok) throw new Error(`Permission stream failed: ${JSON.stringify(result)}`)
    if (mode === 'full') {
      if (result.approvals.length || !result.response.reply?.includes('已暂停')) throw new Error('Contact full policy still prompts or failed to persist')
    } else if (result.approvals.length !== 1 || !result.response.reply?.includes('已拒绝')) throw new Error(`Contact ${mode} did not preserve confirmation`)
  }
  await choose('full')
  await run("window.electronAPI.tools.setEnabled('update_contact_topic',false)")
  try { const result = await invoke('full', true); if (!result.response.reply?.includes('禁用') || result.approvals.length) throw new Error('Contact policy bypassed disabled tool') }
  finally { await run("window.electronAPI.tools.setEnabled('update_contact_topic',true)") }
  const artifacts = process.env.CHOUYU_SMOKE_ARTIFACTS
  const capture = async (name: string, selector: string) => {
    if (!artifacts) return
    mkdirSync(artifacts, { recursive: true })
    for (const theme of ['light', 'dark'] as const) {
      saveConfig({ theme }); window.webContents.send('config:changed', getConfig())
      for (const width of [375, 1024]) {
        window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 900 }, viewPosition: { x: 0, y: 0 }, viewSize: { width, height: 900 }, deviceScaleFactor: 1, scale: 1 })
        await run('new Promise(resolve=>setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)),250))')
        await run(`(()=>{for(const sheet of document.querySelectorAll('.contact-work-sheet,.chat-panel'))Object.assign(sheet.style,{left:'8px',top:'8px',width:'${width - 16}px',height:'880px',transform:'none'});document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'});})()`)
        await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        if (!await run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth+1 && el.scrollWidth<=el.clientWidth+1})()`)) throw new Error(`${name} overflowed`)
        if (name === 'contact-permission-remedy' && !await run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}).querySelector('button[type=submit]'),r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`)) throw new Error('Retry button is covered at this viewport')
        writeFileSync(join(artifacts, `${name}-${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG())
      }
    }
    window.webContents.disableDeviceEmulation()
  }
  await capture('contact-tool-policy', '[data-contact-tool-policy]')
  await run("document.querySelector('[aria-label=\"关闭联系人工作弹窗\"]').click()")
  const failureStore = new ContactTaskStore(join(directory, 'agents.db'))
  let cardId: string
  try {
    const topic = failureStore.topics.get(character.id, topicId)
    failureStore.changeTopic(character.id, topicId, topic.revision, { status: 'planned', reason: '隔离权限失败验收' })
    const runId = failureStore.createRun(character.id, '')
    failureStore.fail(runId, '工作计划自动修复后仍未通过校验：网页访问权限不足：计划地址不在允许访问的网页范围内。 本轮已停止，已有成果保留。')
    const notice = failureStore.notices.pending(character.id).find(n => n.runId === runId)!
    if (!notice.interactionId) throw new Error('First failure has no interactive remedy')
    cardId = notice.interactionId; appendAgentNotice(notice); failureStore.notices.ack(character.id, notice.id)
  } finally { failureStore.close() }
  window.webContents.send('sessions:changed')
  window.webContents.send('agents:changed', character.id)
  const selector = `[data-contact-interaction="${cardId}"]`
  await waitForRenderer(window, `Boolean(document.querySelector(${JSON.stringify(selector)})?.querySelector('button[type=submit]'))`)
  await run(`document.querySelector(${JSON.stringify(selector)}).querySelector('summary').click()`)
  await run("document.querySelector('[aria-label=\"窗口模式\"]').click()")
  await waitForRenderer(window, "Boolean(document.querySelector('[data-workspace-mode-option=chat]'))")
  await run("document.querySelector('[data-workspace-mode-option=chat]').click()")
  await capture('contact-permission-remedy', selector)
  const click = async (expression: string) => {
    await run(`(${expression}).scrollIntoView({block:'center'})`)
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    const point = await run(`(()=>{const el=${expression},r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!el.contains(document.elementFromPoint(x,y)))throw new Error('Button is covered');return {x:Math.round(x),y:Math.round(y)}})()`)
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
  }
  await click(`Array.from(document.querySelector(${JSON.stringify(selector)}).querySelectorAll('button')).find(b=>b.textContent==='联系人权限设置')`)
  await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet [data-contact-tool-policy]'))")
  if (!(await run("document.querySelector('.contact-work-sheet').textContent")).includes(character.name)) throw new Error('Remedy opened another contact')
  const stillPending = await run(`window.electronAPI.agents.getInteraction(${JSON.stringify(character.id)},${JSON.stringify(cardId)})`)
  if (stillPending.status !== 'pending') throw new Error('Opening permissions resolved the failure without retry')
  await click(`document.querySelector('[data-work-permission="public"]')`)
  await waitForRenderer(window, "document.querySelector('.work-settings-flat')?.getAttribute('aria-busy')==='false'")
  const settings = await run(`window.electronAPI.agents.get(${JSON.stringify(character.id)})`)
  if (settings.settings.permissionLevel !== 'public') throw new Error('Remedy permission did not persist')
  await run("document.querySelector('[aria-label=\"关闭联系人工作弹窗\"]').click()")
  await click(`document.querySelector(${JSON.stringify(selector)}).querySelector('button[type=submit]')`)
  await waitForRenderer(window, `Boolean(document.querySelector(${JSON.stringify(selector)})?.querySelector('.contact-interaction-result')) && !document.querySelector(${JSON.stringify(selector)})?.querySelector('button[type=submit]')`)
  const resolved = await run(`window.electronAPI.agents.getInteraction(${JSON.stringify(character.id)},${JSON.stringify(cardId)})`)
  if (resolved.status !== 'resolved') throw new Error('Failure remedy was not resolved')
  // The same persisted interaction must follow real newer states, without rewriting the sent notice.
  const stateStore = new ContactTaskStore(join(directory, 'agents.db'))
  try {
    // Do not race the real worker executing the permission-retry task above.
    const scene = stateStore.topics.create(character.id, { title: '资料失败与恢复验收', goal: '读取指定资料后写作', constraints: '' }, 'isolated fixture')
    const failed = stateStore.createRun(character.id, '', Date.now(), scene.id)
    stateStore.fail(failed, '资料不在本轮目录快照内，请按本轮提供的版本读取。')
    const notice = stateStore.notices.pending(character.id).find(n => n.runId === failed)!
    appendAgentNotice(notice); stateStore.notices.ack(character.id, notice.id)
    window.webContents.send('sessions:changed'); window.webContents.send('agents:changed', character.id)
    const materialSelector = `[data-contact-interaction="${notice.interactionId}"]`
    await waitForRenderer(window, `document.querySelector(${JSON.stringify(materialSelector)})?.querySelector('.contact-interaction-title')?.textContent==='资料引用需要纠正'`)
    const text = await run(`document.querySelector(${JSON.stringify(materialSelector)}).textContent`)
    if (!text.includes('请求的资料或版本不在本次可用目录中') || text.includes('仍受工作时间和额度限制')) throw Error('Material failure still hides its actual cause')
    await capture('contact-material-failure', materialSelector)
    const newer = stateStore.createRun(character.id, '', Date.now(), scene.id)
    stateStore.setStatus(newer, 'running')
    window.webContents.send('agents:changed', character.id)
    await waitForRenderer(window, `document.querySelector(${JSON.stringify(materialSelector)})?.querySelector('.contact-interaction-title')?.textContent==='正在重新尝试'`)
    if (await run(`Boolean(document.querySelector(${JSON.stringify(materialSelector)})?.querySelector('button[type=submit]'))`)) throw Error('Old failure still offers a retry during newer work')
    await capture('contact-retry-running', materialSelector)
    stateStore.setStatus(newer, 'cancelled')
  } finally { stateStore.close() }
  console.log('CHOUYU_SMOKE_CONTACT_PERMISSIONS_PASSED persisted=true isolated=true forcedConfirmation=true disabledTool=true firstFailure=true remedyNavigation=true settingsThenRetry=true realClicks=true')
}
