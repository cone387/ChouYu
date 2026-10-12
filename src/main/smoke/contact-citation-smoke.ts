import { app, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { AgentStore } from '../agents/store'
import { flushDatabase, getSessions, getSession, getActiveSession, selectChatSession } from '../database'
import { waitForRenderer } from './storage-smoke'

export async function runContactCitationSmoke(window: BrowserWindow, owner: string, topicId: string) {
  const originalSession = getActiveSession().id
  const run = (script: string) => window.webContents.executeJavaScript(script)
  const click = async (selector: string) => {
    const point = await run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled)throw Error('Missing citation control '+${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point }); window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
  }
  const fill = (selector: string, value: string) => run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  const select = () => run("(()=>{const el=document.querySelector('.contact-portfolio .delivery-reader .contact-markdown p');const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);return selection.toString()})()")
  const store = new AgentStore(join(app.getPath('userData'), 'contact-agents', 'agents.db'))
  try {
    const count = store.overview(owner).runs.length, version = store.deliveries.get(topicId)!.version
    const quote = await select()
    await click('.contact-portfolio [data-delivery-revise]')
    await waitForRenderer(window, 'Boolean(document.querySelector("[data-contact-revision-dialog][open]"))')
    if (store.overview(owner).runs.length !== count) throw new Error('Selecting revision started work before submission')
    await click('[data-contact-revision-dialog] button[type=button]')
    await waitForRenderer(window, '!document.querySelector("[data-contact-revision-dialog]")')
    await select(); await click('.contact-portfolio [data-delivery-revise]')
    await waitForRenderer(window, 'Boolean(document.querySelector("[data-delivery-feedback]"))')
    await fill('[data-delivery-feedback]', '保留这一段，只修改其他内容。')
    const runId = store.createRun(owner, '', Date.now(), topicId), old = store.deliveries.get(topicId)!
    store.finish(runId, { runId, title: '新版', body: '新版海风', nextStep: '继续', evidence: [], createdAt: Date.now() }, [],
      { status: 'researching', judgement: '新版已保存', nextStep: '继续', openQuestions: '', reason: '保存' },
      { completionCriteria: old.completionCriteria, stages: old.stages, summary: old.summary, section: { id: 'b', title: '第二节：回声', body: '新版灯塔仍在薄雾中。' } })
    await click('[data-delivery-submit]')
    await waitForRenderer(window, 'document.querySelector("[data-contact-revision-dialog] [role=alert]")?.textContent.includes("新版")')
    if (await run('document.querySelector("[data-delivery-feedback]").value') !== '保留这一段，只修改其他内容。') throw new Error('Stale citation erased feedback')
    if (store.overview(owner).runs.length !== count + 1) throw new Error('Stale citation created a new run')
    const directory = process.env.CHOUYU_SMOKE_ARTIFACTS
    if (directory) {
      mkdirSync(directory, { recursive: true })
      for (const theme of ['light', 'dark']) for (const width of [375, 1024]) {
        await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
        window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 768 }, viewSize: { width, height: 768 }, deviceScaleFactor: 1, scale: 1, viewPosition: { x: 0, y: 0 } })
        await waitForRenderer(window, `innerWidth===${width}`)
        await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
        if (!await run("(()=>{const d=document.querySelector('[data-contact-revision-dialog]'),r=d.getBoundingClientRect(),t=d.querySelector('textarea');t.blur();const border=getComputedStyle(t).borderColor;t.focus();const s=getComputedStyle(t);return d.querySelectorAll('textarea').length===1&&d.querySelectorAll('input,select').length===0&&r.left>=0&&r.right<=innerWidth&&s.outlineStyle==='none'&&s.boxShadow==='none'&&s.borderColor===border})()")) throw new Error('Revision dialog layout or focus decoration regressed')
        await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        writeFileSync(join(directory, `citation-dialog-${theme}-${width}.png`), (await window.webContents.capturePage({ x: 0, y: 0, width, height: 768 }, { stayHidden: true, stayAwake: true })).toPNG())
      }
      window.webContents.disableDeviceEmulation()
    }
    await click('[data-contact-revision-dialog] footer button[type=button]')
    await select(); await click('.contact-portfolio [data-delivery-discuss]')
    await waitForRenderer(window, 'Boolean(document.querySelector(".agent-composer-reference"))')
    if (await run('document.querySelector(".agent-composer-reference").textContent') === '') throw new Error('Citation draft missing')
    await fill('.input-textarea', '这段文字的节奏怎么样？只讨论，不修改。')
    await run("document.querySelector('.input-textarea').focus()")
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
    await waitForRenderer(window, 'Boolean(document.querySelector(".message .contact-citation, .contact-citation"))', 15000)
    await waitForRenderer(window, '!document.querySelector(".agent-composer-reference")')
    flushDatabase()
    const messages = getSessions().filter(s => s.characterId === owner).flatMap(s => getSession(s.id)?.messages ?? [])
    const sent = messages.find(m => m.role === 'user' && m.contactCitations?.length)
    if (sent?.contactCitations?.[0].ref.version !== version || sent.contactCitations[0].anchor?.quote !== quote) throw new Error('Exact citation was not persisted')
    if (sent.content.includes(topicId)) throw new Error('Internal reference leaked into user prose')
    if (store.overview(owner).runs.length !== count + 1) throw new Error('Discussion unexpectedly started task work')
    await click('.contact-citation button')
    await waitForRenderer(window, `document.querySelector('.contact-work-sheet[open] .contact-delivery')?.dataset.deliveryVersion===${JSON.stringify(String(version))}`)
    await waitForRenderer(window, `getSelection()?.toString()===${JSON.stringify(quote)}`)
    console.log('[smoke] contact citations passed: selection/cancel, stale draft retained, exact sent version, discussion read-only, original quote navigation')
  } finally { store.close(); selectChatSession(originalSession); flushDatabase() }
}
