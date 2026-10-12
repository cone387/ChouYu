import { app, type BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AgentStore } from '../agents/store'
import { restartAgentsForSmoke } from '../agents'
import { waitForRenderer } from './storage-smoke'
import { runContactCitationSmoke } from './contact-citation-smoke'

/** Actual renderer, preload, worker and isolated SQLite; no production user data. */
export async function runContactPortfolioSmoke(window: BrowserWindow, owner: string) {
  const run = (script: string) => window.webContents.executeJavaScript(script)
  const click = async (selector: string) => {
    const point = await run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled)throw Error('Missing portfolio control '+${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
  }
  const file = join(app.getPath('userData'), 'contact-agents', 'agents.db'), store = new AgentStore(file)
  const topic = store.topics.create(owner, { title: '海边手记', goal: '写一组海边故事', constraints: '' }, '隔离验收')
  const write = (text: string, sectionId = 'a') => {
    const runId = store.createRun(owner, '', Date.now(), topic.id)
    store.finish(runId, { runId, title: '手记', body: text, nextStep: '继续', evidence: [], createdAt: Date.now() }, [],
      { status: 'researching', judgement: '已保存', nextStep: '继续', openQuestions: '', reason: '交付正文' },
      { completionCriteria: '完成故事', stages: [{ id: 'write', title: '创作', status: 'active' }], summary: '已保存故事', section: { id: sectionId, title: sectionId === 'a' ? '第一节：海风' : '第二节：回声', body: text } })
  }
  try {
    write(Array.from({ length: 75 }, (_, i) => `第 ${i + 1} 段。海风吹过长堤，她听见潮汐与远处归船的声音。重复😀的句子，仍应回到自己读过的位置。`).join('\n\n'))
    write('灯塔在薄雾中亮了起来。', 'b')
    await click('[data-agent-tab=portfolio]')
    await waitForRenderer(window, 'Boolean(document.querySelector(".portfolio-open"))')
    await click('[data-portfolio-favorite]')
    await waitForRenderer(window, 'document.querySelector("[data-portfolio-favorite]")?.getAttribute("aria-pressed")==="true"')
    await click('.portfolio-open')
    await waitForRenderer(window, 'document.querySelector(".contact-portfolio .contact-delivery")?.dataset.deliveryVersion==="2"')
    await click('.contact-portfolio .delivery-directory button:first-child')
    const point = await run(`(()=>{const el=document.querySelector('.contact-portfolio .delivery-reader-scroll');el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
    await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    window.webContents.sendInputEvent({ type: 'mouseMove', ...point })
    window.webContents.sendInputEvent({ type: 'mouseWheel', deltaY: -800, deltaX: 0, ...point })
    await waitForRenderer(window, "document.querySelector('.contact-portfolio .delivery-reader-scroll')?.scrollTop>100").catch(e => { console.error('PORTFOLIO_INITIAL_SCROLL'); throw e })
    // Closing before the debounce expires must still persist the last position.
    await click('[data-portfolio-back]')
    await waitForRenderer(window, '!document.querySelector(".contact-portfolio .delivery-reader-scroll")')
    await waitForRenderer(window, `(async()=>{const p=await window.electronAPI.agents.deliveryReading(${JSON.stringify(owner)},${JSON.stringify(topic.id)});return p?.ref.version===2&&p.scrollRatio>0})()`)
    const position = store.portfolio.reading(owner, topic.id)!
    if (store.portfolio.list(owner, {}).items[0].sections.filter(s => s.readHash).length !== 1) throw new Error('Unread sections were marked read')
    await restartAgentsForSmoke()
    await click('[data-agent-tab=memory]'); await click('[data-agent-tab=portfolio]')
    await waitForRenderer(window, 'document.querySelector("[data-portfolio-favorite]")?.getAttribute("aria-pressed")==="true"')
    await click('.portfolio-open')
    await waitForRenderer(window, 'Boolean(document.querySelector(".contact-portfolio [data-delivery-resume]"))')
    await click('.contact-portfolio [data-delivery-resume]')
    await waitForRenderer(window, "document.querySelector('.contact-portfolio .delivery-reader-scroll')?.scrollTop>100").catch(async e => { console.error('PORTFOLIO_RESUME', position, await run("({text:document.querySelector('.contact-portfolio .contact-delivery')?.textContent,scroll:document.querySelector('.contact-portfolio .delivery-reader-scroll')?.scrollTop})")); throw e })
    const beforeVersion = await run('document.querySelector(".contact-portfolio .contact-delivery").dataset.deliveryVersion')
    write('这一版修改了海风的声音。')
    await waitForRenderer(window, 'Boolean(document.querySelector(".contact-portfolio [data-delivery-latest]"))')
    if (await run('document.querySelector(".contact-portfolio .contact-delivery").dataset.deliveryVersion') !== beforeVersion) throw new Error('Background delivery replaced the reading version')
    await run(`dispatchEvent(new MessageEvent('message',{data:{type:'delivery-reading',nonce:'forged',ref:${JSON.stringify(position.ref)},scrollRatio:1,anchor:${JSON.stringify(position.anchor)}}}))`)
    if (store.portfolio.reading(owner, topic.id)?.scrollRatio !== position.scrollRatio) throw new Error('Forged frame event changed reading')
    const directory = process.env.CHOUYU_SMOKE_ARTIFACTS
    if (directory) {
      mkdirSync(directory, { recursive: true })
      const stylesheet = await window.webContents.insertCSS('.chat-panel{position:fixed!important;inset:0!important;width:100%!important;height:100%!important;min-width:0!important;max-width:none!important;transform:none!important}.contacts-detail{max-width:100%!important}')
      for (const theme of ['light', 'dark']) for (const width of [375, 1024]) {
        await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
        window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 768 }, viewSize: { width, height: 768 }, deviceScaleFactor: 1, scale: 1, viewPosition: { x: 0, y: 0 } })
        await waitForRenderer(window, `innerWidth===${width}`)
        await run("document.querySelector('.contact-portfolio .delivery-reader-scroll').scrollIntoView({block:'center'})")
        await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
        if (!await run("(()=>{const el=document.querySelector('.contact-portfolio .delivery-reader-scroll'),r=el.getBoundingClientRect();return r.width>100&&r.left>=0&&r.right<=innerWidth&&el.scrollWidth<=el.clientWidth+2})()")) throw new Error('Reader exceeds narrow viewport')
        await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        writeFileSync(join(directory, `portfolio-reader-${theme}-${width}.png`), (await window.webContents.capturePage({ x: 0, y: 0, width, height: 768 }, { stayHidden: true, stayAwake: true })).toPNG())
      }
      window.webContents.disableDeviceEmulation()
      await window.webContents.removeInsertedCSS(stylesheet)
    }
    await click('[data-portfolio-back]')
    await run(`(()=>{const el=document.querySelector('[data-portfolio-search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'灯塔');el.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await click('.portfolio-filters button[type=submit]')
    await waitForRenderer(window, 'document.querySelector(".portfolio-open")?.textContent.includes("灯塔")')
    await click('.portfolio-open')
    await waitForRenderer(window, 'document.querySelector(".contact-portfolio .delivery-reader")?.textContent.includes("灯塔")')
    console.log('[smoke] contact portfolio passed: persisted favorite/reading, exact search version, update isolation, frame rejection')
    if (process.env.CHOUYU_SMOKE_CONTACT_CITATION_ONLY === '1') await runContactCitationSmoke(window, owner, topic.id)
  } finally { store.close() }
}
