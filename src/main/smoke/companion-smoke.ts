import type { BrowserWindow } from 'electron'
import { createServer } from 'node:http'
import { getConfig, saveConfig, getSession, getSessions, getActiveSession, createChatSession, deleteChatSession, getState, setState } from '../database'
import { waitForRenderer } from './storage-smoke'
import { snapshots } from './chat-smoke'

/** Exercise the actual trigger IPC and durable state independently of scheduled-task form timing. */
export async function runCompanionSmoke(window: BrowserWindow) {
  const original = getConfig(), run = (code: string) => window.webContents.executeJavaScript(code)
  let modelCalls = 0, characterId = ''
  const server = createServer((request, response) => {
    if (request.method === 'GET') { response.end(JSON.stringify({ data: [{ id: 'companion-smoke' }] })); return }
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      let input: { tasks?: Array<{ reason: string }> }
      try { input = JSON.parse(JSON.parse(body).messages.at(-1).content) }
      catch { response.writeHead(400); response.end('invalid fixture request'); return }
      if (!input.tasks?.some((t: { reason: string }) => t.reason.includes('预算不足'))) {
        response.writeHead(400); response.end('missing work evidence'); return
      }
      modelCalls++
      response.setHeader('Content-Type', 'text/event-stream')
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: '写作任务因预算不足暂停，已有内容保留。你可以打开任务查看原因。' } }] })}\n\ndata: [DONE]\n\n`)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  saveConfig({ provider: 'openai', baseUrl: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/v1`, apiKey: 'smoke-only', model: 'companion-smoke', aiToolsEnabled: true,
    proactiveGreeting: false, proactiveReturn: false, proactiveRestReminder: false })
  window.webContents.send('config:changed', getConfig())
  const sessionId = createChatSession('主动工作检查验收', 'chouyu').activeSession.id
  try {
    const contact = await run("window.electronAPI.characters.create({name:'写作验收联系人',model:'companion-smoke',soulMd:'验收'})")
    characterId = contact.id
    const overview = await run(`window.electronAPI.agents.createTopic(${JSON.stringify(characterId)}, {title:'小说写作',goal:'继续写作',constraints:''})`)
    const topic = overview.topics[0]
    await run(`window.electronAPI.agents.topicStatus(${JSON.stringify(characterId)},${JSON.stringify(topic.id)},${topic.revision},'paused','预算不足，已保存两章')`)
    window.webContents.send('sessions:changed')
    window.webContents.send('open-assistant-chat')
    await waitForRenderer(window, "Boolean(document.querySelector('[data-character-bar=chouyu]'))")
    await run(`[...document.querySelectorAll('.conversation-item-main')].find(b => b.textContent.includes('主动工作检查验收'))?.click()`)
    await waitForRenderer(window, "document.querySelector('.conversation-item.active .conversation-item-title')?.textContent === '主动工作检查验收'")
    const before = getActiveSession().id
    saveConfig({ proactiveGreeting: true, proactiveReturn: true })
    await run("window.electronAPI.proactiveAppend('早上好',undefined,'greeting','companion-smoke-day')")
    const deliveredSession = getSessions().find(s => getSession(s.id)?.messages.some(m => m.assistantKind === 'greeting'))!
    const greeting = getSession(deliveredSession.id)!.messages.find(m => m.assistantKind === 'greeting')!
    if (!greeting?.content.includes('预算不足') || !greeting.content.includes(`#contact-task?characterId=${characterId}`) || modelCalls !== 1) throw new Error('Work greeting did not use real state and model')
    if (getActiveSession().id !== before) throw new Error('Work greeting changed the reading session')
    await run("window.electronAPI.proactiveAppend('早上好',undefined,'greeting','companion-smoke-day')")
    if (getSession(deliveredSession.id)!.messages.filter(m => m.assistantKind === 'greeting').length !== 1) throw new Error('Duplicate greeting')
    await run("window.electronAPI.proactiveAppend('欢迎回来',undefined,'return','companion-smoke-return')")
    if (!getSession(deliveredSession.id)!.messages.at(-1)?.content.includes('没有新的变化') || modelCalls !== 1) throw new Error('Return did not share the delivered baseline')
    saveConfig({ proactiveGreeting: false, proactiveReturn: false })
    await run(`[...document.querySelectorAll('.conversation-item-main')].find(b => b.textContent.includes(${JSON.stringify(deliveredSession.title)}))?.click()`)
    await run("document.querySelector('.message-focus-banner button')?.click()")
    await waitForRenderer(window, "document.querySelector('[data-assistant-kind=greeting]')?.textContent.includes('预算不足')")
    await snapshots(window, 'companion-work-briefing', '[data-assistant-kind=greeting]')
    await run("document.querySelector('[data-assistant-kind=greeting] a[href^=\"#contact-task?\"]').click()")
    await waitForRenderer(window, `Boolean(document.querySelector('.contact-work-sheet[open] [data-topic-current="${topic.id}"]'))`)
    await snapshots(window, 'companion-task-link', '.contact-work-sheet[open]')
    // Revoking the tool must produce an honest notice, no additional model call.
    setState('tool:inspect_contacts:enabled', 'false')
    saveConfig({ proactiveReturn: true })
    await run("window.electronAPI.proactiveAppend('欢迎回来',undefined,'return','companion-smoke-disabled')")
    if (modelCalls !== 1 || !getSession(deliveredSession.id)!.messages.at(-1)?.content.includes('没有检查工作')) throw new Error('Disabled tool was not honored')
    if (!getState('reminder-receipt:companion:companion-smoke-day')) throw new Error('Delivery receipt missing')
    console.log('CHOUYU_COMPANION_WORK_SMOKE_PASSED real IPC/SQLite/contact inspection/model summary/task links/no session switch/durable dedupe/shared baseline/tool disabled')
  } finally {
    saveConfig({ proactiveGreeting: false, proactiveReturn: false })
    if (characterId) await run(`window.electronAPI.characters.remove(${JSON.stringify(characterId)})`)
    deleteChatSession(sessionId)
    saveConfig(original)
    window.webContents.send('config:changed', getConfig())
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}
