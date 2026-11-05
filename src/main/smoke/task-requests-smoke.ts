import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { createCharacter, saveConfig, getActiveSession, getSession, saveSessionMessages, selectChatSession, flushDatabase } from '../database'
import { contactAgentsCall, restartAgentsForSmoke } from '../agents'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { waitForRenderer } from './storage-smoke'

/** Isolated worker + preload + shared task UI; no external model service or user profile. */
export async function runTaskRequestsSmoke(window: BrowserWindow) {
  assert.equal(process.env.CHOUYU_SMOKE_TEST, '1')
  const originalSession = getActiveSession().id
  saveConfig({ provider: 'openai', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'fixture', model: 'fixture' })
  const run = (code: string) => window.webContents.executeJavaScript(code)
  const owner = createCharacter({ name: '任务请求验收', avatar: '🧪', category: 'other', soulMd: '独立验收联系人' }).id
  const workspace = await run(`window.electronAPI.db.createSession('任务请求验收',${JSON.stringify(owner)})`)
  const sessionId = workspace.activeSession.id
  saveSessionMessages(sessionId, [{ id: 'edited-source', role: 'user', content: '改回原要求', timestamp: 100, editRevision: 2 }])
  assert.equal(getSession(sessionId)?.messages[0].editRevision, 2)
  await contactAgentsCall(owner, 'save', [{ ...DEFAULT_AGENT_SETTINGS, enabled: false, goal: '独立请求记录验收' }])
  let overview = await contactAgentsCall(owner, 'get')
  const topicId = overview.topics[0].id
  await contactAgentsCall(owner, 'topicStatus', [topicId, overview.topics[0].revision, 'paused', '验收期间暂停'])
  for (let index = 1; index <= 23; index++) {
    overview = await contactAgentsCall(owner, 'get')
    const topic = overview.topics.find(item => item.id === topicId)!, text = `原始要求 ${index}：保留依据，再增加案例。`
    if (index === 23) saveSessionMessages(sessionId, [{ id: 'edited-source', role: 'user', content: text, timestamp: 100, editRevision: 2 }])
    const args = { topicId, revision: topic.revision, constraints: text, reason: '模型概括' }
    const submission = { source: { requestId: `smoke:${index}`, sessionId, text, acceptedAt: Date.now(), ...(index === 23 ? { messageId: 'edited-source' } : {}) }, tool: 'edit_contact_task', arguments: args }
    const values: [number, 'editTaskFromChat', [string, number, { constraints: string }, string], typeof submission] = [overview.revision, 'editTaskFromChat', [topicId, topic.revision, { constraints: text }, args.reason], submission]
    await contactAgentsCall(owner, 'feedback', values)
    if (index === 23) await contactAgentsCall(owner, 'feedback', values)
  }
  await restartAgentsForSmoke()
  overview = await contactAgentsCall(owner, 'get')
  assert.equal(overview.topics.find(item => item.id === topicId)?.status, 'paused')
  assert.equal(overview.runs.length, 0)
  const page = await run(`window.electronAPI.agents.taskRequests(${JSON.stringify(owner)},${JSON.stringify(topicId)})`)
  assert.equal(page.items.length, 20); assert.equal(page.items[0].source.text, '原始要求 23：保留依据，再增加案例。')
  window.webContents.send('open-chat-panel')
  await waitForRenderer(window, "Boolean(document.querySelector('[data-panel-window=main]'))")
  await run(`new Promise((resolve,reject)=>{const detail={target:${JSON.stringify({ kind: 'task', characterId: owner, topicId })},handled:false,resolve,reject};window.dispatchEvent(new CustomEvent('chouyu:contact-navigation',{detail}));if(!detail.handled)reject(Error('No navigation handler'))})`)
  await waitForRenderer(window, "[...document.querySelectorAll('.contact-work-sheet[open] [role=tab]')].some(b=>b.textContent==='互动记录')")
  await run("[...document.querySelectorAll('.contact-work-sheet[open] [role=tab]')].find(b=>b.textContent==='互动记录').click()")
  const root = '.contact-work-sheet[open] [aria-label="任务请求记录"]'
  await waitForRenderer(window, `document.querySelectorAll('${root} > ol > li').length===20`)
  assert.match(await run(`document.querySelector('${root}').textContent`), /要求已保存，尚无后续执行记录/)
  assert.equal(await run(`Array.from(document.querySelectorAll('${root} button')).some(b=>b.textContent.includes('成果版本')||b.textContent.includes('本轮记录'))`), false)
  await run(`Array.from(document.querySelectorAll('${root} button')).find(b=>b.textContent==='更早的请求').click()`)
  await waitForRenderer(window, `document.querySelectorAll('${root} > ol > li').length===23`)
  await contactAgentsCall(owner, 'remember', ['分页阅读期间的独立更新'])
  await waitForRenderer(window, `Array.from(document.querySelectorAll('${root} button')).some(b=>b.textContent==='刷新记录')`)
  assert.equal(await run(`document.querySelectorAll('${root} > ol > li').length`), 23)
  const artifacts = process.env.CHOUYU_SMOKE_ARTIFACTS || 'artifacts/task-requests/electron'
  mkdirSync(artifacts, { recursive: true })
  for (const theme of ['light', 'dark']) {
    await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.querySelector('${root}').scrollIntoView({block:'center'})`)
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    window.webContents.invalidate()
    await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    writeFileSync(join(artifacts, `requests-${theme}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
  }
  await run(`Array.from(document.querySelectorAll('${root} button')).find(b=>b.textContent==='查看原始消息').click()`)
  await waitForRenderer(window, "document.querySelector('[data-message-id=edited-source]')?.textContent.includes('原始要求 23')")
  assert.equal(getActiveSession().id, sessionId)
  selectChatSession(originalSession); assert.ok(!flushDatabase().error)
  console.log('TASK_REQUESTS_SMOKE_PASSED records=23 duplicate=1 runs=0 restart=1')
}
