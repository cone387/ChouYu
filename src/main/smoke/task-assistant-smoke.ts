import type { BrowserWindow } from 'electron'
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createChatSession, flushDatabase, getActiveSession, getConfig, getSession, saveConfig, selectChatSession } from '../database'
import { waitForRenderer } from './storage-smoke'

/** Real tools, real IPC/approval UI, isolated SQLite, and a loopback model. */
export async function runTaskAssistantSmoke(window: BrowserWindow): Promise<void> {
  const originalConfig = getConfig(), originalSession = getActiveSession().id
  const originalMessages = JSON.stringify(getActiveSession().messages)
  const run = (code: string) => window.webContents.executeJavaScript(code)
  // A preceding suite may leave a retained panel bound to its original session.
  // Unmount and drain its saves before selecting this suite's isolated fixture.
  await run("document.querySelector('[aria-label=\"关闭面板\"]')?.click()")
  await waitForRenderer(window, "!document.querySelector('.chat-panel')")
  await run('window.electronAPI.db.getSessionWorkspace()')
  const fixture = createChatSession('AI任务助手验收').activeSession.id
  let step = 0, scenario = '', target = '', other = '', dueAt = Date.now() + 3 * 86400000
  let responses: string[] = []
  const server = createServer((request, response) => {
    if (request.url === '/v1/models') { response.end(JSON.stringify({ data: [{ id: 'task-smoke' }] })); return }
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      const payload = JSON.parse(body)
      responses = payload.messages.filter((m: { role: string }) => m.role === 'tool').map((m: { content: string }) => m.content)
      const version = responses.flatMap(value => { try { const data = JSON.parse(value); return data.version ? [data.version] : [] } catch { return [] } }).at(-1)
      let name = '', args: Record<string, unknown> = {}
      const current = step++
      if (current === 0) name = 'list_task_projects'
      if (current === 1) { name = 'search_tasks'; args = { query: '助手验收同名' } }
      if (current === 2) { name = 'get_task'; args = { taskId: target } }
      if (current === 3) {
        name = scenario === 'complete' ? 'complete_task' : 'update_task'
        args = { taskId: target, expectedVersion: version, ...(scenario === 'complete' ? {} : { dueAt: new Date(dueAt + 86400000).toISOString() }) }
      }
      if (current === 4 && scenario === 'multiple') { name = 'complete_task'; args = { taskId: other, expectedVersion: version } }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const delta = name ? { tool_calls: [{ index: 0, id: `${scenario}_${current}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } : { content: '验收完成。' }
      response.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Task smoke provider failed to start')
  const start = async (name: string) => {
    scenario = name; step = 0; responses = []
    await run(`window.__taskAssistantResult = null; window.electronAPI.ai.startStream(${JSON.stringify({ requestId: `task_${name}`, sessionId: fixture, systemPrompt: '测试单任务操作', messages: [{ role: 'user', content: '读取任务并修改明确选定的一个任务。' }] })}).then(result => { window.__taskAssistantResult = result }); void 0`)
    await waitForRenderer(window, "document.querySelector('.tool-approval-preview')")
  }
  const finish = async () => {
    await waitForRenderer(window, 'window.__taskAssistantResult !== null')
    return run('window.__taskAssistantResult')
  }
  const get = (id: string) => run(`window.electronAPI.tasks.get(${JSON.stringify(id)})`)
  try {
    saveConfig({ provider: 'openai', baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'isolated-smoke', model: 'task-smoke', memoryEnabled: false, aiToolsEnabled: true, toolPermissionMode: 'full' })
    window.webContents.send('config:changed', getConfig())
    await run("window.electronAPI.db.setState('workspace-active-page', 'chat')")
    window.webContents.send('open-chat-panel')
    await waitForRenderer(window, "document.querySelector('.chat-panel[data-ready=true]') && document.querySelector('.input-textarea')")
    await waitForRenderer(window, "document.querySelector('.conversation-item-main[aria-selected=true]')?.textContent.includes('AI任务助手验收')")
    target = (await run(`window.electronAPI.tasks.create(${JSON.stringify({ title: '助手验收同名', dueAt, remindAt: dueAt - 3600000, recurrence: 'daily' })})`)).id
    other = (await run("window.electronAPI.tasks.create({title:'助手验收同名'})")).id

    await start('deny')
    const preview = await run("document.querySelector('.tool-approval-preview').textContent")
    if (!preview.includes(target) || !preview.includes('任务提醒：') || !preview.includes('重复日期基准')) throw new Error('Task preview lacks real target or scheduling effects')
    const directory = process.env.CHOUYU_SMOKE_ARTIFACTS
    if (directory) {
      mkdirSync(directory, { recursive: true })
      await run("window.__taskAssistantPanelStyle = document.querySelector('.chat-panel').getAttribute('style')")
      for (const theme of ['light', 'dark']) {
        await run(`document.documentElement.dataset.theme = '${theme}'`)
        for (const width of [1024, 375]) {
          window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 768 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, viewSize: { width, height: 768 }, scale: 1 })
          await waitForRenderer(window, `innerWidth === ${width} && Number(getComputedStyle(document.querySelector('.chat-panel')).opacity) > .99`)
          // Workspace coordinates intentionally persist independently of viewport
          // emulation. Size this fixture explicitly to test the dialog at each width.
          await run(`Object.assign(document.querySelector('.chat-panel').style, {left:'8px',top:'8px',width:'${width - 16}px',height:'744px'})`)
          await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
          await new Promise(resolve => setTimeout(resolve, 200))
          const geometry = await run("(() => {const el = document.querySelector('.tool-approval-dialog'), r = el.getBoundingClientRect(); return {rect:r.toJSON(),scroll:el.scrollWidth,client:el.clientWidth,panel:document.querySelector('.chat-panel').getBoundingClientRect().toJSON()}})()")
          if (geometry.scroll > geometry.client + 1 || geometry.rect.x < 0 || geometry.rect.right > width + 1) throw new Error(`Task approval overflows at ${width}: ${JSON.stringify(geometry)}`)
          const bounds = { x: Math.floor(geometry.rect.x), y: Math.floor(geometry.rect.y), width: Math.ceil(geometry.rect.width), height: Math.ceil(geometry.rect.height) }
          writeFileSync(join(directory, `task-assistant-approval-${theme}-${width}.png`), (await window.webContents.capturePage(bounds)).toPNG())
        }
      }
      window.webContents.disableDeviceEmulation()
      await run("document.querySelector('.chat-panel').setAttribute('style', window.__taskAssistantPanelStyle || '')")
      await run(`document.documentElement.dataset.theme = ${JSON.stringify(originalConfig.theme === 'dark' ? 'dark' : 'light')}`)
    }
    await run("document.querySelector('.tool-approval-actions .secondary').click()")
    await finish()
    if ((await get(target)).dueAt !== dueAt || !responses.some(value => value.includes('用户拒绝'))) throw new Error('Denied task change was not preserved')
    await waitForRenderer(window, "document.querySelectorAll('.tool-task-sources button').length >= 2")

    await start('stale')
    await run(`window.electronAPI.tasks.update(${JSON.stringify(target)}, {note:'确认期间手动修改'})`)
    await run("document.querySelector('.tool-approval-actions .primary').click()")
    await finish()
    if ((await get(target)).dueAt !== dueAt || !responses.some(value => value.includes('确认期间任务已变化'))) throw new Error('Stale task approval overwrote data')

    await start('cancel')
    await run("window.electronAPI.ai.cancelStream('task_cancel')")
    await finish()
    await waitForRenderer(window, "!document.querySelector('.tool-approval-dialog')")
    if ((await get(target)).dueAt !== dueAt) throw new Error('Cancelled task changed data')

    await start('multiple')
    await run("document.querySelector('.tool-approval-actions .primary').click()")
    const completed = await finish()
    if (!completed.ok || (await get(target)).dueAt !== dueAt + 86400000 || (await get(other)).status !== 'open' || !responses.some(value => value.includes('不支持批量处理'))) throw new Error('Single task boundary or confirmed change failed')
    dueAt += 86400000

    await start('complete')
    if (!await run("document.querySelector('.tool-approval-preview').textContent.includes('下一期')")) throw new Error('Repeat completion warning missing')
    await run("document.querySelector('.tool-approval-actions .primary').click()")
    await finish()
    if ((await get(target)).status !== 'done' || (await get(other)).status !== 'open') throw new Error('Wrong same-name task completed')
    await run("document.querySelector('.tool-task-sources button').click()")
    await waitForRenderer(window, "document.querySelector('.tasks-view')")
    console.log('CHOUYU_TASK_ASSISTANT_SMOKE_PASSED query sources, five-round tools, forced approval in full mode, deny/cancel/stale guards, single-task boundary and recurring completion')
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    if (target) await run(`window.electronAPI.tasks.remove(${JSON.stringify(target)})`).catch(() => {})
    if (other) await run(`window.electronAPI.tasks.remove(${JSON.stringify(other)})`).catch(() => {})
    const remaining = await run('window.electronAPI.tasks.list()')
    for (const task of remaining.open.filter((item: { title: string }) => item.title === '助手验收同名')) await run(`window.electronAPI.tasks.remove(${JSON.stringify(task.id)})`)
    saveConfig(originalConfig)
    window.webContents.send('config:changed', getConfig())
    // The harness deletes this isolated profile after exit; retain the fixture until
    // renderer persistence settles so closing cannot save into a deleted session.
    await run("document.querySelector('[aria-label=\"关闭面板\"]')?.click()")
    await waitForRenderer(window, "!document.querySelector('.chat-panel')")
    await run('window.electronAPI.db.getSessionWorkspace()')
    selectChatSession(originalSession)
    flushDatabase()
    if (JSON.stringify(getSession(originalSession)?.messages) !== originalMessages) throw new Error('Task assistant smoke changed the preceding suite session')
  }
}
