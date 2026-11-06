import { app, ipcMain, type BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ContactTaskStore } from '../task-center/contact-store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { waitForRenderer } from './storage-smoke'

/** Read-only UI audit in the smoke profile, optionally using an offline snapshot. */
export async function runContactWorkbenchSmoke(window: BrowserWindow) {
  // Deterministic catalogue data: this audit tests layout, not network availability.
  ipcMain.removeHandler('skills:browse'); ipcMain.removeHandler('skills:categories')
  ipcMain.handle('skills:categories', () => [{ key: 'writing', name: '内容创作' }])
  ipcMain.handle('skills:browse', () => ({ total: 3, skills: ['写作与表达', '研究资料整理', '阅读助手'].map((name, index) => ({ id: `@fixture/layout-${index}`, name, description: '布局验收示例：整理思路，检查关键信息，保留清晰的结论和依据。', category: 'writing', source: 'community', downloads: 12000, stars: 82 })) }))
  const owner = 'preset-copywriter-bi'
  const run = (code: string) => window.webContents.executeJavaScript(code)
  const root = '.contact-work-sheet[open]'
  const click = async (selector: string) => {
    await waitForRenderer(window, `Boolean(document.querySelector(${JSON.stringify(selector)}))`)
    const point = await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();const x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);if(e.disabled||!e.contains(document.elementFromPoint(x,y)))throw Error('Covered control: '+${JSON.stringify(selector)});return {x,y}})()`)
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
  }
  if (!process.env.CHOUYU_WORKBENCH_SNAPSHOT) {
    await run(`window.electronAPI.agents.save('${owner}',${JSON.stringify({ ...DEFAULT_AGENT_SETTINGS, goal: '隔离布局验收：创作故事', enabled: false })})`)
    const store = new ContactTaskStore(join(app.getPath('userData'), 'contact-agents', 'agents.db'))
    try {
      const topic = store.topics.create(owner, { title: '请创作中文原创短篇《雨停之前的旧书店》，分三个带小标题的场景，有具体细节和人物对话', goal: '写一篇故事', constraints: '' }, '隔离布局验收')
      const id = store.createRun(owner, '', Date.now(), topic.id)
      store.finish(id, { runId: id, title: '旧书店', body: '雨点落在旧书店的玻璃上。年轻人推开门，看见柜台上留着一盏灯。', nextStep: '继续创作', evidence: [], createdAt: Date.now() }, [], { status: 'researching', judgement: '已保存', nextStep: '继续创作', openQuestions: '', reason: '已保存正文' }, { completionCriteria: '完成故事', stages: [{ id: 'write', title: '创作', status: 'active' }], summary: '开篇已保存', section: { id: 'opening', title: '雨夜', body: '雨点落在旧书店的玻璃上。年轻人推开门，看见柜台上留着一盏灯。' } })
      store.memoryLibrary.create(owner, { content: '故事需要具体细节与自然的人物对话，保留章节之间的人物关系与情节连续性。'.repeat(6), kind: 'project', scope: { kind: 'task', topicId: topic.id }, source: { kind: 'user', at: Date.now() } })
    } finally { store.close() }
  }
  window.webContents.send('open-chat-panel')
  await waitForRenderer(window, "Boolean(document.querySelector('.chat-panel')) && getComputedStyle(document.querySelector('.chat-panel')).display!=='none'")
  await click('[aria-label="窗口模式"]')
  await click('[data-workspace-mode-option="workspace"]')
  await click('[data-workspace-nav="contacts"]')
  await waitForRenderer(window, `Boolean(document.querySelector('[data-contacts-card-detail="${owner}"]'))`)
  await run(`document.querySelector('[data-contacts-card-detail="${owner}"]').click()`)
  await click('[data-agent-expand]')
  await waitForRenderer(window, `Boolean(document.querySelector('${root} [data-home-tasks]'))`, 20000)
  // Mark the sheet as user-positioned through its normal pointer handler, so
  // ResizeObserver does not recenter it while testing explicit window sizes.
  await click(`${root} .contact-work-sheet-heading strong`)
  const directory = process.env.CHOUYU_SMOKE_ARTIFACTS || join(process.cwd(), 'artifacts/contact-workbench')
  mkdirSync(directory, { recursive: true })
  const checks: unknown[] = [], failures: string[] = []
  const ready: Record<string, string> = { overview: '[data-home-tasks]', work: '.topic-list', portfolio: '.portfolio-list', memory: '.agent-memories', materials: '.contact-materials', skills: '[data-catalog-skill]', profile: '.contacts-detail-soul', settings: '.work-settings-flat', history: '.agent-history', analytics: '.usage-summary' }
  for (const [viewport, width] of [[1024, 820], [1440, 560], [375, 343]]) for (const theme of ['light', 'dark']) {
    window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width: viewport, height: 768 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, viewSize: { width: viewport, height: 768 }, scale: 1 })
    await waitForRenderer(window, `innerWidth===${viewport}`)
    await run(`document.documentElement.dataset.theme='${theme}';Object.assign(document.querySelector('${root}').style,{left:'16px',top:'16px',transform:'none',width:'${width}px',height:'720px'});document.querySelector('${root}').dataset.resized='true'`)
    for (const tab of Object.keys(ready)) {
      await run(`document.querySelector('${root} [data-contact-dialog-tab=${tab}]').click()`)
      await waitForRenderer(window, `document.querySelector('${root}').dataset.view==='${tab}' && Boolean(document.querySelector('${root} ${ready[tab]}'))`, 20000)
      await run(`document.querySelector('${root} .contact-work-sheet-content').scrollTop=0;document.activeElement?.blur();new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`)
      // The analytics table intentionally scrolls horizontally inside its own
      // bounded scroller; it must not expand the page's scrolling surface.
      const metrics = await run(`(()=>{const e=document.querySelector('${root}'),c=e.querySelector('.contact-work-sheet-content'),r=c.getBoundingClientRect();const overflow=[...c.querySelectorAll('*')].filter(n=>!n.closest('.usage-table table')&&n.getClientRects().length&&getComputedStyle(n).position!=='absolute'&&(n.getBoundingClientRect().right>r.right+1||n.getBoundingClientRect().left<r.left-1)).slice(0,12).map(n=>n.className||n.tagName);const labels=[...e.querySelectorAll('.contact-work-tab-group>small')].map(n=>n.textContent);const input=e.querySelector('[data-portfolio-search]'),submit=e.querySelector('.portfolio-filters button[type=submit]');return {overflow,labels,scrollWidth:c.scrollWidth,contentWidth:c.clientWidth,search:input&&submit?{input:input.getBoundingClientRect().toJSON(),button:submit.getBoundingClientRect().toJSON(),checkboxDirection:getComputedStyle(e.querySelector('.portfolio-favorite-filter')).flexDirection}:null}})()`)
      checks.push({ viewport, width, theme, tab, ...metrics })
      writeFileSync(join(directory, 'layout.json'), JSON.stringify({ checks, failures }, null, 2))
      if (metrics.overflow.length || metrics.scrollWidth > metrics.contentWidth + 1 || metrics.labels.length) failures.push(`${theme}-${viewport}-${width}-${tab}: overflow or inert navigation labels`)
      if (tab === 'portfolio' && (Math.abs(metrics.search.input.bottom - metrics.search.button.bottom) > 2 || metrics.search.checkboxDirection !== 'row')) failures.push(`${theme}-${viewport}-${width}: search controls not aligned`)
      await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      writeFileSync(join(directory, `${theme}-${viewport}-${width}-${tab}.png`), (await window.webContents.capturePage({ x: 0, y: 0, width: viewport, height: 768 }, { stayHidden: true, stayAwake: true })).toPNG())
    }
  }
  // Exercise the changed controls without mutating the contact's records.
  const select = async (tab: string) => {
    await run(`document.querySelector('${root} [data-contact-dialog-tab=${tab}]').click()`)
    await waitForRenderer(window, `document.querySelector('${root}').dataset.view==='${tab}' && Boolean(document.querySelector('${root} ${ready[tab]}'))`)
  }
  const capture = async (name: string) => {
    await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    const rect = await run(`(()=>{const r=document.querySelector('${root}').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`)
    writeFileSync(join(directory, `${name}.png`), (await window.webContents.capturePage(rect, { stayHidden: true, stayAwake: true })).toPNG())
  }
  await select('portfolio')
  await run(`(()=>{const e=document.querySelector('${root} [data-portfolio-search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'__布局验收无匹配__');e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await click(`${root} .portfolio-filters button[type=submit]`)
  await waitForRenderer(window, `document.querySelector('${root} .agent-empty')?.textContent.includes('没有符合条件')`)
  await capture('search-empty-dark-narrow')
  await select('memory')
  await click(`${root} [data-contact-memory-new]`)
  await waitForRenderer(window, "Boolean(document.querySelector('[data-contact-memory-dialog][open]'))")
  if (!await run("(()=>{const s=getComputedStyle(document.querySelector('[data-contact-memory-input]'));return s.outlineStyle==='none'&&s.boxShadow==='none'})()")) throw Error('Memory input gained a focus decoration')
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await waitForRenderer(window, `!document.querySelector('[data-contact-memory-dialog]') && Boolean(document.querySelector('${root}'))`)
  await run(`(()=>{const c=document.querySelector('${root} .contact-work-sheet-content');c.scrollTop=c.scrollHeight})()`)
  await capture('memory-bottom-dark-narrow')
  await select('overview')
  await run(`document.querySelector('${root} [data-home-tasks]').scrollIntoView({block:'end'})`)
  await capture('overview-tasks-dark-narrow')
  for (const [viewport, width] of [[1024, 820], [375, 343]]) {
    window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width: viewport, height: 768 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, viewSize: { width: viewport, height: 768 }, scale: 1 })
    await waitForRenderer(window, `innerWidth===${viewport}`)
    await run(`Object.assign(document.querySelector('${root}').style,{left:'16px',top:'16px',width:'${width}px',height:'720px'})`)
    await select('work')
    await run(`[...document.querySelectorAll('${root} .topic-list-card')].at(-1).click()`)
    for (const tab of ['overview', 'stages', 'delivery', 'interactions', 'history']) {
      await run(`document.querySelector('${root} .topic-content-tabs [id$="-${tab}"]').click()`)
      await waitForRenderer(window, `document.querySelector('${root} [id$="-${tab}-panel"]')?.hidden===false`)
      await capture(`task-${tab}-${width}`)
    }
  }
  writeFileSync(join(directory, 'layout.json'), JSON.stringify({ checks, failures }, null, 2))
  if (failures.length && !process.env.CHOUYU_WORKBENCH_BASELINE) throw Error(failures.join('\n'))
  console.log(`CHOUYU_CONTACT_WORKBENCH_${failures.length ? 'BASELINE' : 'PASSED'} captures=${checks.length} layoutFailures=${failures.length} search/Esc/focus/subpages checked`)
}
