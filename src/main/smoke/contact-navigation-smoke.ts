import { app, ipcMain, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { AgentStore } from '../agents/store'
import { createCharacter, listCharacters, getActiveSession, selectChatSession, flushDatabase } from '../database'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { waitForRenderer } from './storage-smoke'

export async function runContactNavigationSmoke(window: BrowserWindow, owner: string) {
  const run = (code: string) => window.webContents.executeJavaScript(code)
  const click = async (selector: string) => {
    const point = await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Missing navigation control '+${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);if(!e.contains(document.elementFromPoint(x,y)))throw Error('Navigation control covered '+${JSON.stringify(selector)});return {x,y}})()`)
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point }); window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
  }
  const navigate = (target: unknown) => run(`new Promise((resolve,reject)=>{const detail={target:${JSON.stringify(target)},handled:false,resolve,reject};window.dispatchEvent(new CustomEvent('chouyu:contact-navigation',{detail}));if(!detail.handled)reject(Error('No navigation handler'))})`)
  const fill = (selector: string, value: string, select = false) => run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${select ? 'HTMLSelectElement' : 'HTMLTextAreaElement'}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('${select ? 'change' : 'input'}',{bubbles:true}))})()`)
  const store = new AgentStore(join(app.getPath('userData'), 'contact-agents', 'agents.db'))
  const originalSession = getActiveSession().id
  try {
    const recipient = createCharacter({ name: '返回路径评审者', soulMd: '只读评审', model: 'review-model' })
    for (const id of [owner, recipient.id]) await run(`window.electronAPI.agents.save(${JSON.stringify(id)},${JSON.stringify({ ...DEFAULT_AGENT_SETTINGS, enabled: false, goal: 'Navigation acceptance' })})`)
    const topic = store.topics.create(owner, { title: '返回路径稿件', goal: 'Write a story', constraints: '' }, 'user')
    const publish = (body: string) => { const id = store.createRun(owner, '', Date.now(), topic.id); store.finish(id, { runId: id, title: '稿件', body, nextStep: 'Continue', evidence: [], createdAt: Date.now() }, [], { status: 'researching', judgement: 'Saved', reason: 'Saved', nextStep: 'Continue', openQuestions: '' }, { completionCriteria: 'Finish', stages: [{ id: 'write', title: '创作', status: 'active' }], summary: 'Saved', section: { id: 'text', title: '正文', body } }) }
    publish('第一版：她沿着海岸寻找灯塔。')
    await navigate({ kind: 'delivery', ref: { characterId: owner, topicId: topic.id, version: 1, sectionId: 'text' } })
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet[open] [data-delivery-handoff]'))")
    await click('.contact-work-sheet[open] [data-delivery-handoff]')
    await waitForRenderer(window, `Boolean(document.querySelector('[data-handoff-recipient] option[value="${recipient.id}"]'))`)
    await fill('[data-handoff-recipient]', recipient.id, true); await fill('[data-contact-handoff-dialog] [data-task-description]', '保留我的草稿：请评审灯塔这一版。')
    await click('[data-handoff-save]'); await waitForRenderer(window, "Boolean(document.querySelector('[data-contact-handoff-dialog] [role=alert]'))")
    await click('[data-contact-handoff-dialog] .agent-actions button:last-child')
    await waitForRenderer(window, `Boolean(document.querySelector('.contact-work-sheet[open] [data-contact-agent="${recipient.id}"]'))&&!document.querySelector('[data-contact-handoff-dialog]')`)
    publish('第二版：她已经找到灯塔。')
    await click('.contact-work-sheet[open] [data-contact-return]')
    await waitForRenderer(window, "Boolean(document.querySelector('[data-contact-handoff-dialog]'))")
    if (!await run("document.querySelector('[data-contact-handoff-dialog]').textContent.includes('第 1 版')&&document.querySelector('[data-contact-handoff-dialog] [data-task-description]').value.includes('保留我的草稿')")) throw new Error('Settings return lost immutable version or draft')
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await waitForRenderer(window, "!document.querySelector('[data-contact-handoff-dialog]')&&Boolean(document.querySelector('.contact-work-sheet[open]'))")
    await click('.contact-work-sheet[open] [data-contact-dialog-tab=analytics]')
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet[open][data-view=analytics] .contact-agent [data-contact-return]'))")
    await click('.contact-work-sheet[open] .contact-agent [data-contact-return]')
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet[open][data-view=portfolio] [data-delivery-version=\"1\"]'))")
    const directory = join(process.cwd(), 'artifacts', 'contact-navigation'); mkdirSync(directory, { recursive: true })
    try {
      for (const theme of ['light', 'dark']) for (const width of [375, 1024]) {
        await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
        window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 900 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, viewSize: { width, height: 900 }, scale: 1 })
        await waitForRenderer(window, `innerWidth===${width}`); await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        if (!await run("(()=>{const e=document.querySelector('.contact-work-sheet[open]'), r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&e.scrollWidth<=e.clientWidth+1&&[...e.querySelectorAll('[data-contact-dialog-tab]')].every(b=>b.getBoundingClientRect().right<=r.right)})()")) throw new Error('Navigation overflows viewport')
        await window.webContents.capturePage(); writeFileSync(join(directory, `${theme}-${width}.png`), (await window.webContents.capturePage({ x: 0, y: 0, width, height: 900 })).toPNG())
      }
    } finally { window.webContents.disableDeviceEmulation(); await run("document.documentElement.dataset.theme='light'") }
    // A removed source is reported rather than silently replaced by another task.
    await click('.contact-work-sheet[open] [data-contact-dialog-tab=analytics]')
    store.deleteTopic(owner, topic.id, store.topics.get(owner, topic.id)!.revision)
    await click('.contact-work-sheet[open] .contact-agent [data-contact-return]')
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet[open] .agent-error[role=alert]'))")
    await click('.contact-work-sheet[open] [aria-label="关闭联系人工作弹窗"]')
    const questionTopic = store.topics.create(owner, { title: '待回复的真实事项', goal: 'Ask', constraints: '' }, 'user'), questionRun = store.createRun(owner, '', Date.now(), questionTopic.id)
    store.wait(questionRun, '你希望保留哪一种结尾？')
    await click('[data-contacts-start-chat]')
    await waitForRenderer(window, `Boolean(document.querySelector('[data-contact-pending="${owner}"]'))`)
    await click(`[data-contact-pending="${owner}"]`)
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-pending-dialog[open] textarea'))")
    await fill('.contact-pending-dialog[open] textarea', '这是尚未提交的回复草稿。')
    await run("document.querySelector('.contact-pending-dialog[open] textarea').focus()")
    await navigate({ kind: 'contact-settings', characterId: owner, tab: 'skills' })
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet[open][data-view=skills]'))")
    await click('.contact-work-sheet[open] [data-contact-return]')
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-pending-dialog[open] textarea'))")
    if (await run("document.querySelector('.contact-pending-dialog[open] textarea').value") !== '这是尚未提交的回复草稿。') throw new Error('Pending reply draft lost')
    if (!store.decisions.pending(owner).some(item => item.topicId === questionTopic.id)) throw new Error('Settings return resolved pending work')
    // Complete a newer navigation before an earlier lookup returns.
    await click('.contact-pending-dialog[open] [aria-label="关闭待处理事项"]')
    let firstLookup = true
    ipcMain.removeHandler('characters:list'); ipcMain.handle('characters:list', async () => { if (firstLookup) { firstLookup = false; await new Promise(resolve => setTimeout(resolve, 200)) } return listCharacters() })
    try {
      await run(`(()=>{const nav=target=>new Promise((resolve,reject)=>window.dispatchEvent(new CustomEvent('chouyu:contact-navigation',{detail:{target,resolve,reject,handled:false}})));window.__lateNavigation=nav({kind:'contact-settings',characterId:${JSON.stringify(recipient.id)},tab:'settings'}).then(()=>false,()=>true);return nav({kind:'contact-settings',characterId:${JSON.stringify(owner)},tab:'skills'})})()`)
      if (!await run('window.__lateNavigation')) throw new Error('Stale navigation was not rejected')
      await waitForRenderer(window, `Boolean(document.querySelector('.contact-work-sheet[open][data-view=skills] [data-contact-agent="${owner}"]'))`)
    } finally { ipcMain.removeHandler('characters:list'); ipcMain.handle('characters:list', () => listCharacters()) }
    console.log('CHOUYU_CONTACT_NAVIGATION_SMOKE_PASSED settings return, original version, retained draft, nested Escape, analytics, deleted source, chat pending, late navigation and responsive themes')
  } finally { store.close(); selectChatSession(originalSession); await flushDatabase() }
}
