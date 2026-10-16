import { app, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createCharacter, getActiveSession, selectChatSession } from '../database'
import { TaskCenter } from '../task-center/store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { waitForRenderer } from './storage-smoke'

export async function runContactCardLinksSmoke(window: BrowserWindow) {
  const run = (code: string) => window.webContents.executeJavaScript(code)
  const original = getActiveSession().id
  const owner = createCharacter({ name: '直达验收作者', soulMd: '直接交付保存的正文。' }).id
  await run(`window.electronAPI.agents.get(${JSON.stringify(owner)})`)
  const store = new TaskCenter(join(app.getPath('userData'), 'contact-agents', 'agents.db'))
  const click = async (selector: string) => {
    const point = await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Missing card control '+${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point }); window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
  }
  const fill = (selector: string, value: string) => run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  try {
    store.save(owner, { ...DEFAULT_AGENT_SETTINGS, goal: 'Card navigation fixture', enabled: false })
    const story = store.topics.create(owner, { title: '海边来信', goal: 'Write', constraints: '' }, 'Fixture')
    const publish = (body: string) => {
      const id = store.createRun(owner, '', Date.now(), story.id)
      store.finish(id, { runId: id, title: '海边来信', body, nextStep: 'Continue', evidence: [], createdAt: Date.now() }, [], { status: 'researching', judgement: 'Saved', reason: 'Saved', nextStep: 'Continue', openQuestions: '' })
    }
    publish('第一版原文：她在灯塔下等着那封信。')
    const question = store.topics.create(owner, { title: '原问题', goal: 'Ask', constraints: '' }, 'Fixture'), questionRun = store.createRun(owner, '', Date.now(), question.id)
    store.wait(questionRun, '原问题：结尾保留悬念还是重逢？')
    const interaction = store.decisions.pending(owner).find(item => item.topicId === question.id)!
    window.webContents.send('open-chat-panel')
    await waitForRenderer(window, "Boolean(document.querySelector('.chat-panel[data-ready=true]'))")
    await run(`document.querySelector('[aria-label="窗口模式"]').click()`)
    await waitForRenderer(window, "Boolean(document.querySelector('[data-workspace-mode-option=workspace]'))")
    await click('[data-workspace-mode-option=workspace]')
    await waitForRenderer(window, "Boolean(document.querySelector('[data-workspace-nav=contacts]'))")
    await click('[data-workspace-nav=contacts]')
    await waitForRenderer(window, `Boolean(document.querySelector('[data-contact-card-pending="${owner}"]'))`)
    await fill('[data-contacts-search]', '直达验收')
    await waitForRenderer(window, `document.querySelector('[data-contacts-search]')?.value === '直达验收' && Boolean(document.querySelector('[data-contact-card-delivery="${owner}"]'))`)
    if (await run("Boolean(document.querySelector('.contacts-card button'))")) throw Error('Card contains nested buttons')
    await click(`[data-contact-card-pending="${owner}"]`)
    await waitForRenderer(window, `Boolean(document.querySelector('.contact-work-sheet[open] [data-contact-interaction="${interaction.id}"] textarea'))`)
    if ((await run('window.electronAPI.db.getSessionWorkspace()')).activeSession.id !== original) throw Error('Question button opened a chat session')
    store.changeTopic(owner, question.id, store.topics.get(owner, question.id)!.revision, { status: 'completed', reason: 'Fixture closes original question' })
    const otherQuestion = store.topics.create(owner, { title: '另一项问题', goal: 'Ask independently', constraints: '' }, 'Fixture'), otherRun = store.createRun(owner, '', Date.now(), otherQuestion.id)
    store.wait(otherRun, '新问题：需要选择另一项工作的方向。')
    window.webContents.send('agents:changed', owner)
    await waitForRenderer(window, `Boolean(document.querySelector('.contact-work-sheet[open] [data-contact-interaction="${interaction.id}"]')) && !document.querySelector('.contact-work-sheet[open] [data-contact-interaction="${interaction.id}"] textarea')`)
    if (!await run(`document.querySelector('.contact-work-sheet[open] [data-contact-interaction="${interaction.id}"]').textContent.includes('原问题')`)) throw Error('Original question was replaced by a newer interaction')
    await click('.contact-work-sheet[open] [aria-label="关闭联系人工作弹窗"]')
    await waitForRenderer(window, "!document.querySelector('.contact-work-sheet[open]')")
    if (await run("document.querySelector('[data-contacts-search]').value") !== '直达验收') throw Error('Card return lost filtering')
    // Save a newer version after the visible card snapshot, without refreshing the card.
    publish('第二版原文：她已经收到回信。')
    console.log('CHOUYU_CARD_SNAPSHOT_VERSION', await run(`document.querySelector('[data-contact-card-delivery="${owner}"]').dataset.contactSourceVersion`))
    await run(`document.querySelector('[data-contact-card-delivery="${owner}"]').focus()`)
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
    try { await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet[open] .contact-portfolio [data-delivery-version=\"1\"]'))") }
    catch (e) { console.log('CHOUYU_CARD_KEYBOARD_STATE', await run(`JSON.stringify({focus:document.activeElement?.outerHTML,dialogs:Array.from(document.querySelectorAll('.contact-work-sheet[open]')).map(e=>e.textContent.slice(0,2500)),errors:Array.from(document.querySelectorAll('[role=alert]')).map(e=>e.textContent)})`)); throw e }
    if (!await run("document.querySelector('.contact-work-sheet[open] .delivery-reader').textContent.includes('第一版原文')")) throw Error('Card opened latest instead of its saved version')
    if ((await run('window.electronAPI.db.getSessionWorkspace()')).activeSession.id !== original) throw Error('Delivery button opened chat')
    await click('.contact-work-sheet[open] [aria-label="关闭联系人工作弹窗"]')
    await waitForRenderer(window, "!document.querySelector('.contact-work-sheet[open]')")
    const directory = 'artifacts/contact-next/card-links-ui'; mkdirSync(directory, { recursive: true })
    const css = await window.webContents.insertCSS('.chat-panel{left:8px!important;top:8px!important;width:calc(100vw - 16px)!important;height:calc(100vh - 16px)!important;max-width:none!important;max-height:none!important}')
    try {
      for (const theme of ['light', 'dark']) for (const width of [375, 1024]) {
        await run(`document.documentElement.dataset.theme='${theme}'`)
        window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 768 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, viewSize: { width, height: 768 }, scale: 1 })
        await waitForRenderer(window, `innerWidth === ${width}`)
        await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        await run(`document.querySelector('[data-contact-card-delivery="${owner}"]').scrollIntoView({block:'center'})`)
        await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        await waitForRenderer(window, `(()=>{const r=document.querySelector('[data-contact-card-delivery="${owner}"]').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()`)
        if (!await run(`(()=>{const card=document.querySelector('[data-contacts-item="${owner}"]').parentElement;const r=card.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&card.scrollWidth<=card.clientWidth+1})()`)) throw Error('Contact card overflows viewport')
        writeFileSync(join(directory, `${theme}-${width}.png`), (await window.webContents.capturePage({ x: 0, y: 0, width, height: 768 })).toPNG())
      }
    } finally { window.webContents.disableDeviceEmulation(); await window.webContents.removeInsertedCSS(css) }
    store.deleteTopic(owner, story.id, store.topics.get(owner, story.id)!.revision)
    await click(`[data-contact-card-delivery="${owner}"]`)
    await waitForRenderer(window, "Boolean(document.querySelector('.contacts-card-source-error[role=alert]'))")
    if (await run("Boolean(document.querySelector('.contact-work-sheet[open]'))")) throw Error('Deleted source opened another task')
    await run(`document.querySelector('[data-contacts-item="${owner}"]').click()`)
    await waitForRenderer(window, `(async()=> (await window.electronAPI.db.getSessionWorkspace()).activeSession.characterId === ${JSON.stringify(owner)})()`)
    console.log('CHOUYU_CONTACT_CARD_LINKS_PASSED exact question, fixed version, no chat bubbling, keyboard, source deletion, filter return, main card chat, responsive screenshots')
  } finally { store.close(); selectChatSession(original) }
}
