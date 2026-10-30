import { app, ipcMain, type BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCharacter, listCharacters, deleteCharacter } from '../database'
import { ContactTaskStore } from '../task-center/contact-store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { beginContactQueryMeasurement, endContactQueryMeasurement } from '../agents/query-metrics'
import { waitForRenderer } from './storage-smoke'
import Database from 'better-sqlite3'
import { openTasksStore } from '../tasks/store'
import { dashboardDays } from '../../shared/dashboard'
import { getUsageStore } from '../usage'

/** Isolated real SQLite/IPC/UI data. No model or external service required. */
export async function runDashboardSmoke(window: BrowserWindow) {
  const run = (code: string) => window.webContents.executeJavaScript(code)
  const click = (selector: string) => run(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const openActivityContact = (name: string) => run(`[...document.querySelectorAll('.contacts-activity-viewport li > button')].find(el=>el.textContent===${JSON.stringify(name)}).click()`)
  const alice = createCharacter({ name: '林舟 · 写作', soulMd: '独立的写作者。' })
  const bob = createCharacter({ name: '许澄 · 评审', soulMd: '独立的评审者。' })
  await run(`window.electronAPI.agents.get(${JSON.stringify(alice.id)})`)
  const store = new ContactTaskStore(join(app.getPath('userData'), 'contact-agents', 'agents.db'))
  const todos = openTasksStore(join(app.getPath('userData'), 'tasks.db'))
  const taskDb = new Database(join(app.getPath('userData'), 'tasks.db'))
  await run('window.electronAPI.journal.status()')
  const journalDb = new Database(join(app.getPath('userData'), 'journal', 'journal.db'))
  const days = dashboardDays(30)
  const usage = getUsageStore()
  for (let i = 0; i < days.length; i++) {
    const at = days[i].from + 9 * 3600000
    for (const [model, tokens] of [['chat-model', 1200 + i % 7 * 1800], ['work-model', 2600 + i % 4 * 2000], ['embedding-model', 150 + i % 3 * 200]] as const) {
      const id = `dashboard-${i}-${model}`
      usage.begin(id, model, Math.min(at, Date.now()))
      usage.update(id, { usage: { totalTokens: tokens - 50 } })
      usage.update(id, { model, usage: { totalTokens: tokens } })
    }
    for (const [name, minutes] of [['Code', 25 + i % 7 * 15], ['浏览器', 15 + i % 4 * 10], ['ChouYu', 10 + i % 3 * 10]] as const) {
      journalDb.prepare('INSERT INTO activities(app,title,startedAt,endedAt) VALUES(?,?,?,?)').run(name, '看板合成验收记录', at, at + minutes * 60000)
    }
    for (let n = 0; n < i % 5; n++) {
      const task = todos.createTask({ title: `验收任务 ${i}-${n}` }); todos.completeTask(task.id)
      taskDb.prepare('UPDATE tasks SET completed_at=? WHERE id=?').run(at, task.id)
    }
  }
  for (let i = 0; i < 8; i++) todos.createTask({ title: `待处理事项 ${i}` })
  taskDb.close(); journalDb.close()
  usage.begin('dashboard-unreported', 'unknown-usage-model')
  const directory = join(process.cwd(), 'artifacts', 'dashboard')
  mkdirSync(directory, { recursive: true })
  try {
    for (const [character, goal, tokens] of [[alice, '灯塔故事的第一章', 2400], [bob, '检查故事节奏与人物动机', 800]] as const) {
      store.save(character.id, { ...DEFAULT_AGENT_SETTINGS, goal, enabled: false })
      const id = store.createRun(character.id, '')
      store.charge(id); store.recordCallMetadata(store.latestCallId(id)!, { usage: { totalTokens: tokens } })
      store.event(id, 'analysis', character.id === alice.id ? '已整理人物线索，正在核对灯塔场景。' : '已读完开篇，第二段的动机需要补充依据。')
      store.wait(id, character.id === alice.id ? '故事采用第一人称还是第三人称？' : '请补充上一版稿件。')
    }
    const topicId = store.overview(alice.id).topics[0].id
    window.webContents.send('open-chat-panel')
    await waitForRenderer(window, "Boolean(document.querySelector('.chat-panel[data-ready=true]'))")
    await click('[data-workspace-nav=dashboard]')
    await waitForRenderer(window, "document.querySelector('[data-app-metric=todos]')?.textContent === '8 项' && document.querySelectorAll('.dashboard-token-panel svg g[tabindex]').length === 7")
    if (await run("document.querySelector('[data-app-metric=tokens]').title") !== usage.statistics(7).tokens!.toLocaleString('zh-CN')) throw Error('App token totals differ from the complete ledger')
    if (!await run("(()=>{const text=document.querySelector('[data-dashboard]').textContent;return !text.includes('记忆分类')&&!text.includes('联系人工作')&&!text.includes('时间、任务与积累')&&!document.querySelector('[data-app-metric=memory]')&&text.includes('1 次调用未上报')})()")) throw Error('Dashboard retained removed modules or hid missing usage')
    await click('.dashboard-period [role=group] button:last-child')
    await waitForRenderer(window, "document.querySelectorAll('.dashboard-token-panel svg g[tabindex]').length === 30 && document.querySelectorAll('.dashboard-time-panel svg g[tabindex]').length === 30")
    // A failed new range must not reuse the preceding range's task statistics.
    ipcMain.removeHandler('tasks:statistics'); ipcMain.handle('tasks:statistics', () => { throw Error('Dashboard task fixture failure') })
    await click('.dashboard-period [role=group] button:first-child')
    await waitForRenderer(window, "Boolean(document.querySelector('.dashboard-todo-panel [role=alert]'))")
    if (!await run("document.querySelector('[data-app-metric=todos]').textContent.startsWith('—') && document.querySelectorAll('.dashboard-token-panel svg g[tabindex]').length === 7")) throw Error('Range failure retained incorrect totals or affected another domain')
    ipcMain.removeHandler('tasks:statistics'); ipcMain.handle('tasks:statistics', (_event, range) => todos.statistics(range))
    await click('.dashboard-todo-panel [role=alert] button')
    await waitForRenderer(window, "document.querySelector('[data-app-metric=todos]')?.textContent === '8 项'")
    for (const page of ['tasks', 'chat', 'journal']) {
      await click(`.dashboard-overview > button:nth-child(${({ tasks: 3, chat: 4, journal: 2 } as Record<string, number>)[page]})`)
      await waitForRenderer(window, `Boolean(document.querySelector('[data-workspace-page="${page}"]'))`)
      await click('[data-workspace-nav=dashboard]')
    }
    await waitForRenderer(window, `document.querySelector('[data-contacts-activity]')?.textContent.includes(${JSON.stringify(alice.name)}) && document.querySelector('[data-contacts-activity]')?.textContent.includes(${JSON.stringify(bob.name)})`)
    await click('[data-workspace-nav=contacts]')
    await waitForRenderer(window, "Boolean(document.querySelector('[data-contacts-root]'))")
    if (await run("Boolean(document.querySelector('.workspace-contacts [data-contacts-activity]'))")) throw Error('Activity feed remained in contacts')
    await click('[data-workspace-nav=dashboard]')
    await openActivityContact(alice.name)
    await waitForRenderer(window, `Boolean(document.querySelector('[data-contacts-detail="${alice.id}"]'))`)
    await click('[data-contacts-close]')
    await waitForRenderer(window, "!document.querySelector('[data-contacts-detail]')")
    await run(`[...document.querySelectorAll('.contacts-activity-task')].find(el=>el.textContent.includes('灯塔故事')).click()`)
    await waitForRenderer(window, `Boolean(document.querySelector('.contact-work-sheet[open] [data-topic-id="${topicId}"][aria-current=true]'))`)
    await click('[aria-label="关闭联系人工作弹窗"]')
    await waitForRenderer(window, "!document.querySelector('.contact-work-sheet[open]')")

    // Hide the dashboard in a workspace with no contact polling.
    await click('[data-workspace-nav=journal]')
    await new Promise(resolve => setTimeout(resolve, 250))
    beginContactQueryMeasurement()
    await new Promise(resolve => setTimeout(resolve, 5500))
    if (endContactQueryMeasurement().some(sample => sample.channel === 'agents:dashboard')) throw Error('Hidden dashboard kept polling')
    await click('[data-workspace-nav=dashboard]')
    await waitForRenderer(window, "Boolean(document.querySelector('[data-contacts-activity]'))")
    const panelStyle = await run("document.querySelector('.chat-panel').getAttribute('style')")
    try {
      await run("document.querySelector('.chat-panel').style.cssText += ';position:absolute!important;inset:0!important;transform:none!important;width:100%!important;height:100%!important;min-width:0!important;max-width:100%!important'")
      for (const theme of ['light', 'dark']) for (const width of [1024, 375]) {
        await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
        window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 900 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, viewSize: { width, height: 900 }, scale: 1 })
        await waitForRenderer(window, `innerWidth === ${width} && document.documentElement.dataset.theme === ${JSON.stringify(theme)}`)
        await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        await run("document.querySelector('.dashboard-scroll').scrollTop=0")
        if (!await run("(()=>{const el=document.querySelector('.dashboard-scroll');return el.clientHeight>0&&el.scrollWidth<=el.clientWidth+1&&document.querySelector('.contacts-activity-viewport').clientHeight>0})()")) throw Error('Dashboard overflow or collapsed activity viewport')
        if (!await run("(()=>{const r=document.querySelector('.contacts-activity-viewport').getBoundingClientRect();const s=document.querySelector('.dashboard-scroll').getBoundingClientRect();return r.top>=s.top&&r.bottom<=s.bottom})()")) throw Error('Live activity requires page scrolling')
        if (!await run(`(()=>{const a=document.querySelector('.dashboard-live-activity').getBoundingClientRect();const t=document.querySelector('.dashboard-token-panel').getBoundingClientRect();return ${width} > 720 ? t.right<=a.left&&Math.abs(t.top-a.top)<2 : t.top>=a.bottom})()`)) throw Error('Token chart overlaps the activity panel')
        // Hidden-window compositor may return the previous emulated frame once.
        await window.webContents.capturePage()
        await new Promise(resolve => setTimeout(resolve, 250))
        writeFileSync(join(directory, `${theme}-${width}.png`), (await window.webContents.capturePage({ x: 0, y: 0, width, height: 900 })).toPNG())
        await run("document.querySelector('.dashboard-chart-grid').scrollIntoView({block:'start'})")
        await new Promise(resolve => setTimeout(resolve, 250))
        writeFileSync(join(directory, `${theme}-${width}-bottom.png`), (await window.webContents.capturePage({ x: 0, y: 0, width, height: 900 })).toPNG())
      }
      for (const width of [1024, 375]) {
        window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 600 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, viewSize: { width, height: 600 }, scale: 1 })
        await waitForRenderer(window, `innerWidth === ${width} && innerHeight === 600`)
        await run("document.querySelector('.dashboard-scroll').scrollTop=0;new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
        if (!await run("(()=>{const r=document.querySelector('.contacts-activity-viewport').getBoundingClientRect();const s=document.querySelector('.dashboard-scroll').getBoundingClientRect();return r.top>=s.top&&r.bottom<=s.bottom})()")) throw Error('Live activity is below the fold in a short window')
      }
    } finally {
      window.webContents.disableDeviceEmulation()
      await run(`document.querySelector('.chat-panel').setAttribute('style',${JSON.stringify(panelStyle ?? '')});document.documentElement.dataset.theme='light'`)
    }
    // A failed directory refresh retains the last values and offers a real retry.
    ipcMain.removeHandler('characters:list')
    ipcMain.handle('characters:list', () => { throw Error('Dashboard directory fixture failure') })
    window.webContents.send('characters:changed')
    await waitForRenderer(window, "Boolean(document.querySelector('[data-dashboard] [role=alert]'))")
    if (await run("document.querySelector('[data-app-metric=todos]').textContent") !== '8 项') throw Error('Activity failure changed app statistics')
    await openActivityContact(alice.name)
    await waitForRenderer(window, "Boolean(document.querySelector('[data-contact-load-dialog] [role=alert]'))")
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await waitForRenderer(window, "!document.querySelector('.dashboard-view .contacts-view-overlay')")
    if (!await run("Boolean(document.querySelector('[data-dashboard]').getClientRects().length)")) throw Error('Escape closed the workspace instead of the failed detail')
    ipcMain.removeHandler('characters:list'); ipcMain.handle('characters:list', () => listCharacters())
    await click('[data-dashboard] [role=alert] button')
    await waitForRenderer(window, "!document.querySelector('[data-dashboard] [role=alert]')")
    deleteCharacter(bob.id); window.webContents.send('characters:changed')
    await waitForRenderer(window, `!document.querySelector('[data-contacts-activity]').textContent.includes(${JSON.stringify(bob.name)})`)
    console.log('CHOUYU_DASHBOARD_SMOKE_PASSED first-screen activity, app token totals, missing usage, removed sections, 7/30 day ranges, stale-range rejection, navigation, source links, hidden polling, retry, deletion and 8 theme/width screenshots')
  } finally {
    store.close()
    todos.close()
    ipcMain.removeHandler('characters:list'); ipcMain.handle('characters:list', () => listCharacters())
    endContactQueryMeasurement()
  }
}
