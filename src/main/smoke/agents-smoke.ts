import { app, dialog, type BrowserWindow } from 'electron'
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getConfig, saveConfig, listCharacters, getActiveSession, getSession, selectChatSession, flushDatabase, createChatSession } from '../database'
import { DEFAULT_CHARACTER_ID, ASSISTANT_CHARACTER_ID } from '../../shared/characters'
import { restartAgentsForSmoke, agentContext } from '../agents'
import { waitForRenderer as rendererWait } from './storage-smoke'
import type { AgentOverview } from '../../shared/agents'
function waitForRenderer(window: BrowserWindow, condition: string, timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Agent UI wait stalled: ${condition}`)), timeout + 1000)
    rendererWait(window, condition, timeout).then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

/** Real utility process, SQLite checkpoints, IPC and contact UI; no paid or external requests. */
export async function runAgentsSmoke(window: BrowserWindow) {
  console.log('CHOUYU_SMOKE_AGENTS_STAGE begin')
  const original = getConfig(), session = getActiveSession().id
  const run = (code: string): Promise<any> => new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`Agent smoke renderer request stalled: ${code.slice(0, 180)}`)), 15000)
    window.webContents.executeJavaScript(code).then(resolve, reject).finally(() => clearTimeout(deadline))
  })
  let calls = 0, modelRequest: any
  let revisionCalls = 0
  let researching = false, researchCalls = 0
  let revisingDelivery = false, revisedSectionId = ''
  let fixtureSession = ''
  let toolStep = 0, scenario = '', toolResponses: string[] = []
  let discussionReceived = ''
  const server = createServer((request, response) => {
    if (request.url === '/v1/models') { response.end(JSON.stringify({ data: [{ id: 'agent-smoke' }] })); return }
    let body = ''; request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      const payload = JSON.parse(body)
      if (payload.messages.some((message: { content?: unknown }) => typeof message.content === 'string' && message.content.startsWith('根据用户对待确认问题'))) {
        revisionCalls++
        const result = { title: '开发者机会研究 · 根据回复修订', body: '按回复聚焦开发者工具。需求存在，个人付费意愿未知。', nextStep: '核对反对证据', question: '', memories: ['需求存在的证据不等于付费意愿，下一轮应继续验证。'],
          progress: { judgement: '需求存在，个人付费意愿未知。', openQuestions: '谁愿意付费？', nextStep: '核对反对证据', reason: '采用用户回复，聚焦开发者工具。', status: 'needs_evidence' },
          delivery: { completionCriteria: '核对开发者需求和付费假设，给出证据与局限', summary: '已根据用户回复聚焦开发者工具。', stages: [{ id: 'research', title: '验证需求', status: 'active' }, { id: 'conclusion', title: '形成判断', status: 'pending' }], section: { id: 'findings', title: '开发者需求', body: '按用户回复只研究开发者工具。资料 [1] 尚不足以验证收益。' } } }
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        response.end(`data: ${JSON.stringify({ model: 'agent-smoke', usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }, choices: [{ delta: { content: JSON.stringify(result) } }] })}\n\ndata: [DONE]\n\n`)
        return
      }
      if (payload.messages.some((message: { content?: unknown }) => typeof message.content === 'string' && message.content.startsWith('你是联系人，刚收到'))) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ title: '研究另一个独立方向', nextStep: '先核对团队检索场景', question: '团队通常检索什么内容？' }) } }] })}\n\ndata: [DONE]\n\n`)
        return
      }
      if (payload.tools?.length) {
        discussionReceived = payload.messages.findLast((message: { role: string; content?: string }) => message.role === 'user' && typeof message.content === 'string' && message.content.includes('【引用联系人工作记录】'))?.content || discussionReceived
        toolResponses = payload.messages.filter((m: { role: string }) => m.role === 'tool').map((m: { content: string }) => m.content)
        const data = toolResponses.flatMap(value => { try { const parsed = JSON.parse(value); return parsed.topics ? [parsed] : [] } catch { return [] } }).at(-1)
        let name = '', args: Record<string, unknown> = {}
        if (toolStep === 0) name = 'get_contact_topics'
        if (toolStep === 1) {
          const topic = data.topics.find((t: { id: string }) => t.id === data.focusTopicId)
          name = scenario === 'assign' ? 'assign_contact_task' : scenario === 'answer' ? 'answer_contact_question' : 'update_contact_topic'
          args = scenario === 'assign' ? { description: '核对团队知识库的检索需求，只读验证，预算 500 元' } : { topicId: topic.id, revision: topic.revision, ...(scenario === 'answer' ? { runId: data.pending[0].id, answer: '开发者工具' } : { action: 'constraints', constraints: '仅验证开发者工具，预算 200 元', reason: '缩小研究范围' }) }
        }
        const step = toolStep++
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        const delta = name ? { tool_calls: [{ index: 0, id: `contact_${scenario}_${step}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } : { content: '已读取操作结果。' }
        response.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`)
        return
      }
      if (researching) {
        researchCalls++
        const planning = payload.messages.some((message: { content: string }) => message.content.startsWith('为联系人'))
        if (body.includes('search-smoke-secret')) throw new Error('Search credential leaked into model input')
        const result = planning ? { action: 'search', query: '团队 免费 替代品', urls: [], reason: '核对团队免费替代品与定价', checkAfterMinutes: 180, ...(revisingDelivery ? { sectionId: revisedSectionId } : {}) } : {
          title: '自主搜索发现的证据', body: '原网页 [1] 有团队收费说明，尚待验证真实付费需求。', nextStep: '跟踪该定价页面变化', question: '', memories: [],
          progress: { judgement: '新来源区分免费个人版和收费团队版', reason: '新读取的网页 [1] 支持进一步核对团队场景', openQuestions: '谁实际愿意付费', nextStep: '跟踪该定价页面变化', status: 'needs_evidence' },
          ...(revisingDelivery ? { delivery: { completionCriteria: '核对团队需求和证据局限', summary: '按用户意见明确证据局限', stages: [{ id: 'verify', title: '验证需求', status: 'active' }], section: { id: revisedSectionId, title: '团队需求与局限', body: '已按修改意见补充局限：资料 [1] 的价格不能证明团队愿意付费。' } } } : {})
        }
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        response.end(`data: ${JSON.stringify({ model: 'agent-smoke', usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }, choices: [{ delta: { content: JSON.stringify(result) } }] })}\n\ndata: [DONE]\n\n`); return
      }
      calls++; modelRequest = JSON.parse(body)
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const judgements = ['需求存在，个人付费意愿未知。', '个人用户不愿付费，转向核对团队需求。', '团队已有免费方案，暂时放弃该方向。']
      const nextStep = calls === 3 ? '' : calls === 2 ? '核对团队已有替代方案与替换意愿。' : '按你熟悉的行业继续核对需求证据。'
      const result = { title: `开发者机会研究 · 第 ${calls} 轮`, body: `资料 [1] 的本轮判断：${judgements[calls - 1]}\n以上为研究判断，不能视为已验证收益。`, nextStep, question: calls === 1 ? '你更熟悉哪个行业？' : '', memories: calls === 1 ? ['需求存在的证据不等于付费意愿，下一轮应继续验证。'] : [], progress: { judgement: judgements[calls - 1], openQuestions: calls === 3 ? '是否存在其他细分人群仍未知。' : '谁愿意付费、现有方案是否足够？', nextStep, reason: calls === 1 ? '资料 [1] 提供需求线索，尚未证明付费意愿。' : calls === 2 ? '新资料 [1] 否定了个人用户付费假设，缩小到团队。' : '资料 [1] 显示团队已有免费替代方案，因此停止投入。', status: calls === 3 ? 'abandoned' : 'needs_evidence' } }
      response.end(`data: ${JSON.stringify({ model: 'agent-smoke', usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }, choices: [{ delta: { content: JSON.stringify(result) } }] })}\n\ndata: [DONE]\n\n`)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Agent smoke model unavailable')
  const id = JSON.stringify(DEFAULT_CHARACTER_ID)
  const get = () => run(`window.electronAPI.agents.get(${id})`) as Promise<AgentOverview>
  const startFeedback = async (name: string) => {
    scenario = name; toolStep = 0; toolResponses = []
    await run(`window.__contactFeedback = null; window.electronAPI.ai.startStream(${JSON.stringify({ requestId: `contact_${name}`, sessionId: fixtureSession, characterId: DEFAULT_CHARACTER_ID, systemPrompt: '测试联系人事项的确认操作', messages: [{ role: 'user', content: name === 'answer' ? '我熟悉开发者工具，回复这个问题继续。' : '把事项约束改为仅验证开发者工具，预算 200 元。' }] })}).then(result => { window.__contactFeedback = result }); void 0`)
    await waitForRenderer(window, "Boolean(document.querySelector('.tool-approval-preview'))", 15000)
  }
  const finishFeedback = async () => {
    await waitForRenderer(window, 'window.__contactFeedback !== null', 15000)
    if (!(await run('window.__contactFeedback')).ok) throw new Error('Contact chat tools failed')
  }
  const waitStatus = async (status: string) => {
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) { const result = await get(); if (result.runs[0]?.status === status) return result; if (result.runs[0]?.status === 'failed') throw new Error(result.runs[0].error); await new Promise(r => setTimeout(r, 80)) }
    throw new Error(`Agent status did not become ${status}: ${JSON.stringify((await get()).runs)}`)
  }
  try {
    window.webContents.debugger.attach('1.3')
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    saveConfig({ provider: 'openai', baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'agent-smoke-secret', model: 'agent-smoke', memoryEnabled: false, aiToolsEnabled: true, toolPermissionMode: 'full' })
    window.webContents.send('config:changed', getConfig())
    await run("document.querySelector('[aria-label=\"关闭面板\"]')?.click()")
    await waitForRenderer(window, "!document.querySelector('.chat-panel')")
    console.log('CHOUYU_SMOKE_AGENTS_STAGE closed-panel')
    await run('window.electronAPI.db.getSessionWorkspace()')
    fixtureSession = createChatSession('联系人 Agent 验收').activeSession.id
    await run("window.electronAPI.db.setState('workspace-active-page', 'chat')")
    window.webContents.send('open-chat-panel')
    await waitForRenderer(window, "Boolean(document.querySelector('.chat-panel[data-ready=true]'))")
    console.log('CHOUYU_SMOKE_AGENTS_STAGE opened-panel')
    await run("document.querySelector('[aria-label=\"窗口模式\"]')?.click()")
    await waitForRenderer(window, "Boolean(document.querySelector('[data-workspace-mode-option=\"workspace\"]'))")
    await run("document.querySelector('[data-workspace-mode-option=\"workspace\"]')?.click()")
    await waitForRenderer(window, "Boolean(document.querySelector('[data-workspace-nav=\"contacts\"]'))")
    console.log('CHOUYU_SMOKE_AGENTS_STAGE workspace-ready')
    await run("document.querySelector('[data-workspace-nav=\"contacts\"]').click()")
    await waitForRenderer(window, `Boolean(document.querySelector('[data-contacts-menu="${DEFAULT_CHARACTER_ID}"]'))`)
    await run(`document.querySelector('[data-contacts-menu="${DEFAULT_CHARACTER_ID}"]').click()`)
    await waitForRenderer(window, `Boolean(document.querySelector('[data-contacts-menu-detail="${DEFAULT_CHARACTER_ID}"]'))`)
    await run(`document.querySelector('[data-contacts-menu-detail="${DEFAULT_CHARACTER_ID}"]').click()`)
    await waitForRenderer(window, "Boolean(document.querySelector('[data-agent-interval]'))", 20000)
    console.log('CHOUYU_SMOKE_AGENTS_STAGE editor-ready')
    const fill = async (selector: string, value: string) => {
      await waitForRenderer(window, `Boolean(document.querySelector(${JSON.stringify(selector)}))`)
      return run(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', {bubbles:true})); })()`)
    }
    if (!await run("document.querySelector('[data-agent-permission]').value === 'public' && !document.querySelector('[data-agent-sources]').required && !document.querySelector('[data-agent-goal]') && !document.querySelector('[data-topic-create]')")) throw new Error('Task setup still exposes a competing entry')
    await run("document.querySelector('[data-agent-tab=settings]').click(); document.querySelector('.agent-work-settings').open=true; document.querySelector('[data-agent-save]').click()")
    await waitForRenderer(window, "document.querySelector('[data-agent-save]')?.disabled === false")
    if ((await get()).topics.length) throw new Error('Saving preferences created a task')
    await run("document.querySelector('[data-agent-sources]').closest('details').open=true")
    await fill('[data-agent-sources]', 'https://chouyu-agent-smoke.invalid/research')
    await run("document.querySelector('[data-agent-save]').click()")
    await waitForRenderer(window, "document.querySelector('[data-agent-save]')?.disabled === false")
    const fixtureSettings = (await get()).settings
    await run(`window.electronAPI.agents.save(${id}, ${JSON.stringify({ ...fixtureSettings, goal: 'Legacy research fixture' })})`)
    await waitForRenderer(window, "document.querySelector('[data-agent-run]')?.disabled === false")
    const other = listCharacters().find(c => c.id !== DEFAULT_CHARACTER_ID && c.id !== ASSISTANT_CHARACTER_ID)!
    await run(`window.electronAPI.agents.remember(${JSON.stringify(other.id)}, 'BOB_PRIVATE_SMOKE')`)
    await run("document.querySelector('[data-agent-run]').click()")
    await run("document.querySelector('[data-agent-tab=work]').click(); document.querySelector('[data-topic-id][aria-current=true]')?.click()")
    const waiting = await waitStatus('waiting')
    await waitForRenderer(window, "document.querySelector('[data-topic-id][aria-current=true]')?.disabled === false")
    await run("document.querySelector('[data-topic-id][aria-current=true]').click()")
    await run("document.querySelector('.topic-content-tabs [id$=activity]').click()")
    const logDirectory = process.env.CHOUYU_SMOKE_ARTIFACTS
    await waitForRenderer(window, "Boolean(document.querySelector('[data-agent-work-log] li[data-kind=waiting]'))")
    await waitForRenderer(window, "(() => { const el=document.querySelector('.agent-work-log-scroll'); return el.clientHeight === 150 && el.scrollHeight-el.clientHeight-el.scrollTop < 17 })()")
    await run("Array.from(document.querySelectorAll('[data-agent-work-log] button')).find(b => b.textContent === '去回复').click()")
    if (!await run("document.activeElement === document.querySelector('.agent-question textarea')")) throw new Error('Work log reply did not focus the answer')
    if (logDirectory) {
      mkdirSync(logDirectory, { recursive: true })
      await run("document.querySelector('[data-agent-work-log]').scrollIntoView({block:'center'})")
      writeFileSync(join(logDirectory, 'work-log-waiting.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
    }
    if (process.env.CHOUYU_SMOKE_WORK_LOG_ONLY === '1') {
      await run("document.querySelector('.agent-work-log-scroll details').open=true")
      await run("const log=document.querySelector('.agent-work-log-scroll'); log.scrollTop=0; log.dispatchEvent(new Event('scroll'))")
      await run(`window.electronAPI.agents.answer(${id}, ${JSON.stringify(waiting.runs[0].id)}, '开发者工具')`)
      await waitStatus('completed')
      await waitForRenderer(window, "Boolean(document.querySelector('.agent-log-new'))")
      if (!await run("document.querySelector('.agent-work-log-scroll').scrollTop === 0")) throw new Error('New work events moved the reader away from older logs')
      await run("document.querySelector('.agent-log-new').click()")
      await waitForRenderer(window, "!document.querySelector('.agent-log-new')")
      await waitForRenderer(window, "(() => { const el=document.querySelector('.agent-work-log-scroll'); return el.scrollHeight-el.clientHeight-el.scrollTop < 17 })()")
      if (!await run("document.querySelector('.agent-log-follow').getAttribute('aria-pressed') === 'true'")) throw new Error('Work log did not resume automatic following')
      if (!await run("(() => { const el=document.querySelector('.agent-work-log-scroll'); return el.scrollHeight-el.clientHeight-el.scrollTop < 17 })()")) throw new Error('New records button did not restore following')
      if (logDirectory) for (const theme of ['light', 'dark']) for (const width of [1024, 375]) {
        await run(`document.documentElement.dataset.theme='${theme}'`)
        window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 768 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, viewSize: { width, height: 768 }, scale: 1 })
        await run("document.querySelector('[data-agent-work-log]').scrollIntoView({block:'center'}); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        if (!await run("(() => {const log=document.querySelector('[data-agent-work-log]'); return log.scrollWidth <= log.clientWidth+1})()")) throw new Error('Work log overflows')
        writeFileSync(join(logDirectory, `work-log-${theme}-${width}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
      }
      await run("Array.from(document.querySelectorAll('[data-agent-work-log] button')).find(b => b.textContent === '查看成果').click()")
      await waitForRenderer(window, "Boolean(document.querySelector('.agent-report'))")
      console.log('CHOUYU_SMOKE_WORK_LOG_PASSED follow=true unread=true reply=true report=true')
      return
    }
    const noticeDeadline = Date.now() + 10000
    while (!getSession(fixtureSession)!.messages.some(m => m.agentNotice?.kind === 'question')) {
      if (Date.now() > noticeDeadline) throw new Error('Proactive question was not delivered')
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    const noticesBefore = getSession(fixtureSession)!.messages.filter(m => m.agentNotice).length
    console.log('CHOUYU_SMOKE_AGENTS_STAGE waiting')
    if (calls !== 1 || modelRequest.max_tokens !== 2200 || JSON.stringify(modelRequest).includes('BOB_PRIVATE_SMOKE')) throw new Error('Agent model budget or isolation failed')
    // Kill the utility process at a durable interrupt; replying must not call the model again.
    await restartAgentsForSmoke()
    console.log('CHOUYU_SMOKE_AGENTS_STAGE restarted')
    await waitStatus('waiting')
    if (getSession(fixtureSession)!.messages.filter(m => m.agentNotice).length !== noticesBefore) throw new Error('Restart duplicated the proactive question')
    await startFeedback('answer')
    const answerPreview = await run("document.querySelector('.tool-approval-preview').textContent")
    if (!answerPreview.includes('你更熟悉哪个行业') || !answerPreview.includes('开发者工具')) throw new Error('Contact answer preview is not concrete')
    await run("document.querySelector('.tool-approval-actions .primary').click()")
    await finishFeedback()
    const completed = await waitStatus('completed')
    console.log('CHOUYU_SMOKE_AGENTS_STAGE completed')
    if (calls !== 1 || revisionCalls !== 1 || completed.callsToday !== 2 || completed.reports.length !== 1 || !completed.reports[0].body.includes('开发者工具') || completed.memories.length !== 1) throw new Error('Agent resume duplicated work or lost results')
    const artifact = await run(`window.electronAPI.agents.delivery(${id}, ${JSON.stringify(completed.focusTopicId)})`)
    if (artifact.version !== 1 || !artifact.sections[0].body.includes('只研究开发者工具')) throw new Error('Feedback did not revise the actual deliverable')
    const exportPath = join(app.getPath('userData'), 'delivery-smoke.md'), originalSaveDialog = dialog.showSaveDialog
    try {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: exportPath })) as typeof dialog.showSaveDialog
      if (!await run(`window.electronAPI.agents.exportDelivery(${id}, ${JSON.stringify(completed.focusTopicId)}, 1)`)) throw new Error('Deliverable export cancelled')
      if (!readFileSync(exportPath, 'utf8').includes('按用户回复只研究开发者工具')) throw new Error('Export omitted revised text')
    } finally { dialog.showSaveDialog = originalSaveDialog }
    const ownContext = await agentContext(DEFAULT_CHARACTER_ID), otherContext = await agentContext(other.id)
    if (!ownContext.includes('开发者机会研究') || ownContext.includes('BOB_PRIVATE_SMOKE') || otherContext.includes('开发者机会研究')) throw new Error('Private chat recall crossed contacts')
    const mismatched = await run(`window.electronAPI.ai.startStream(${JSON.stringify({ requestId: 'agent-owner-boundary', sessionId: fixtureSession, characterId: other.id, systemPrompt: 'test', messages: [{ role: 'user', content: 'test' }] })})`)
    if (mismatched.ok || calls !== 1) throw new Error('A mismatched session was allowed to select another agent identity')
    const record = await run(`window.electronAPI.agents.detail(${id}, ${JSON.stringify(waiting.runs[0].id)})`)
    if (!record.report.evidence[0].hash || !record.events.some((e: { kind: string }) => e.kind === 'answer')) throw new Error('Agent evidence or reply event missing')
    const topicId = completed.topics[0].id
    for (const [index, source] of ['counter-evidence', 'team-evidence'].entries()) {
      if (index === 1) await restartAgentsForSmoke()
      await run(`window.electronAPI.agents.save(${id}, ${JSON.stringify({ ...completed.settings, sources: [`https://chouyu-agent-smoke.invalid/${source}`] })})`)
      await run(`window.electronAPI.agents.run(${id}, ${JSON.stringify(topicId)})`)
      const next = await waitStatus('completed')
      if (next.runs[0].topicId !== topicId || next.reports.length !== index + 2 || calls !== index + 2) throw new Error('Topic continuity lost across rounds')
      if (!JSON.stringify(modelRequest).includes(index === 0 ? '需求存在，个人付费意愿未知' : '个人用户不愿付费，转向核对团队需求')) throw new Error('Next round omitted the prior topic judgement')
    }
    const topicDetail = await run(`window.electronAPI.agents.topicDetail(${id}, ${JSON.stringify(topicId)})`)
    if (topicDetail.topic.status !== 'abandoned' || topicDetail.changes.filter((change: { kind: string }) => change.kind === 'research').length !== 3) throw new Error('Topic decisions were not retained')
    const hashes = new Set((await get()).reports.map(report => report.evidence[0].hash))
    if (hashes.size !== 3) throw new Error('Topic rounds lost their changing evidence')
    console.log('CHOUYU_SMOKE_AGENTS_STAGE topic-three-rounds')
    const taskMetrics = (await get()).topicMetrics![topicId]
    if (taskMetrics.calls !== 4 || taskMetrics.totalTokens !== 480 || taskMetrics.totalReported !== 4 || taskMetrics.runs !== 3 || taskMetrics.models[0] !== 'agent-smoke') throw new Error('Task metrics did not persist real model usage across rounds and restart')
    await run("[...document.querySelectorAll('.agent-tabs button')].find(b => b.textContent.includes('工作记录')).click()")
    await waitForRenderer(window, "Boolean(document.querySelector('.agent-history button'))")
    await run("document.querySelector('.agent-history button').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('.agent-report'))")
    const directory = process.env.CHOUYU_SMOKE_ARTIFACTS
    if (directory) {
      mkdirSync(directory, { recursive: true })
      for (const theme of ['light', 'dark']) {
        await run(`document.documentElement.dataset.theme='${theme}'`)
        for (const width of [1024, 375]) {
          window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 900 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, viewSize: { width, height: 900 }, scale: 1 })
          await run(`Object.assign(document.querySelector('.chat-panel').style,{left:'8px',top:'8px',width:'${width - 16}px',height:'880px'}); window.dispatchEvent(new Event('resize'))`)
          await waitForRenderer(window, `innerWidth === ${width} && document.querySelector('.contacts-detail').getBoundingClientRect().right <= ${width + 1}`)
          await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
          const geometry = await run("(() => { const el=document.querySelector('.contacts-detail'); el.scrollTop=0; const r=el.getBoundingClientRect(); return {x:r.x,right:r.right,scroll:el.scrollWidth,client:el.clientWidth} })()")
          if (geometry.scroll > geometry.client + 1 || geometry.x < 0 || geometry.right > width + 1) throw new Error(`Agent panel overflows: ${JSON.stringify(geometry)}`)
          await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
          writeFileSync(join(directory, `contact-agent-${theme}-${width}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
          await run("document.querySelector('.agent-tabs button').click()")
          await run("document.querySelector('[data-topic-id][aria-current=true]')?.click()")
          await run("document.querySelector('.topic-content-tabs [id$=delivery]').click()")
          await waitForRenderer(window, "document.querySelector('.contact-delivery')?.getBoundingClientRect().width > 0")
          await run("document.querySelector('.contact-delivery')?.scrollIntoView({block:'start'})")
          await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
          const deliveryFits = await run("(() => { const el=document.querySelector('.contact-delivery'); return Boolean(el && el.clientWidth > 0 && el.scrollWidth <= el.clientWidth + 1) })()")
          if (!deliveryFits) throw new Error('Deliverable content overflows')
          writeFileSync(join(directory, `delivery-${theme}-${width}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
          await run("document.querySelectorAll('.agent-tabs button')[1].click()")
        }
      }
      window.webContents.disableDeviceEmulation()
    }
    await run("document.querySelector('[data-contacts-close]').click(); document.querySelector('[data-workspace-nav=\"chat\"]').click()")
    await waitForRenderer(window, `Boolean(document.querySelector('[data-contact-work-tools="${DEFAULT_CHARACTER_ID}"]'))`)
    await waitForRenderer(window, "Boolean(document.querySelector('.agent-message-links button'))")
    if (directory) {
      await run("document.querySelector('[aria-label=\"最大化窗口\"]')?.click()")
      for (const width of [1024, 375]) {
        window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 900 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, viewSize: { width, height: 900 }, scale: 1 })
        await waitForRenderer(window, `innerWidth === ${width}`)
        await run("window.dispatchEvent(new Event('resize')); document.querySelector('[aria-label=\"收起会话列表\"]')?.click()")
        await waitForRenderer(window, `document.querySelector('.chat-panel').getBoundingClientRect().width <= ${width + 1}`)
        await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        const fits = await run(`(() => { const el=document.querySelector('.agent-message-links'), r=el.getBoundingClientRect(); return r.x >= 0 && r.right <= ${width} && el.scrollWidth <= el.clientWidth + 1 })()`)
        if (!fits) throw new Error('Progress links overflow the chat')
        await window.webContents.capturePage({ x: 0, y: 0, width, height: 900 }, { stayHidden: true, stayAwake: true })
        await run('new Promise(resolve => setTimeout(resolve, 160))')
        writeFileSync(join(directory, `contact-message-${width}.png`), (await window.webContents.capturePage({ x: 0, y: 0, width, height: 900 }, { stayHidden: true, stayAwake: true })).toPNG())
      }
      window.webContents.disableDeviceEmulation()
      await run("window.dispatchEvent(new Event('resize')); document.querySelector('[aria-label=\"还原窗口\"]')?.click()")
    }
    await run("document.querySelector('.agent-message-links button').click()")
    await waitForRenderer(window, `document.querySelector('.contact-work-sheet[open] [data-topic-id][aria-current=true]')?.dataset.topicId === ${JSON.stringify(topicId)}`)
    await run("document.querySelector('[aria-label=\"关闭联系人工作弹窗\"]').click(); document.querySelectorAll('.agent-message-links button')[1].click()")
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet .agent-report')?.textContent.includes('个人付费意愿未知')")
    await fill('.input-textarea', '讨论发现时保留的草稿')
    await run("document.querySelector('.contact-work-sheet .agent-record > button.primary').click()")
    await waitForRenderer(window, "!document.querySelector('.contact-work-sheet[open]') && Boolean(document.querySelector('.agent-composer-reference'))")
    if (!await run("document.querySelector('.input-textarea').value === '讨论发现时保留的草稿' && document.querySelector('.agent-composer-reference').textContent.includes('个人付费意愿未知')")) throw new Error('Discussing a finding lost the draft or source')
    if (directory) {
      await run("document.querySelector('[aria-label=\"最大化窗口\"]')?.click()")
      for (const width of [1024, 375]) {
        window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 900 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, viewSize: { width, height: 900 }, scale: 1 })
        await run("window.dispatchEvent(new Event('resize'))")
        await waitForRenderer(window, `innerWidth === ${width}`)
        await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        const fits = await run("(() => { const el=document.querySelector('.agent-composer-reference'), r=el.getBoundingClientRect(); return el.scrollWidth <= el.clientWidth + 1 && r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight })()")
        if (!fits) throw new Error('Work reference overflows the composer')
        await window.webContents.capturePage({ x: 0, y: 0, width, height: 900 }, { stayHidden: true, stayAwake: true })
        await run('new Promise(resolve => setTimeout(resolve, 160))')
        writeFileSync(join(directory, `work-discussion-${width}.png`), (await window.webContents.capturePage({ x: 0, y: 0, width, height: 900 }, { stayHidden: true, stayAwake: true })).toPNG())
      }
      window.webContents.disableDeviceEmulation()
      await run("window.dispatchEvent(new Event('resize')); document.querySelector('[aria-label=\"还原窗口\"]')?.click()")
    }
    await run("document.querySelector('[aria-label=\"移除工作记录引用\"]').click()")
    if (!await run("document.querySelector('.input-textarea').value === '讨论发现时保留的草稿'")) throw new Error('Removing a reference changed the draft')
    if (discussionReceived) throw new Error('Selecting a work reference sent a message automatically')
    await run("document.querySelector('[data-contact-work-tab=\"history\"]').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet[open] .agent-record > button.primary'))")
    await run("document.querySelector('.contact-work-sheet .agent-record > button.primary').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('.agent-composer-reference'))")
    await run("document.querySelector('[aria-label=\"发送消息\"]').click()")
    await waitForRenderer(window, "!document.querySelector('.agent-composer-reference') && document.querySelector('.input-textarea').value === '' && !document.querySelector('[aria-label=\"停止生成\"]')", 15000)
    if (!discussionReceived.includes(topicId) || !discussionReceived.includes(waiting.runs[0].id) || !discussionReceived.includes('讨论发现时保留的草稿')) throw new Error('Chat did not receive the selected work reference and draft')
    await fill('.input-textarea', '保留在聊天输入框中的草稿')
    const chatHeight = await run("document.querySelector('.message-area').getBoundingClientRect().height")
    await run("document.querySelector('[data-contact-work-tab=\"work\"]').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet[open] [data-agent-interval]'))")
    if (Math.abs(await run("document.querySelector('.message-area').getBoundingClientRect().height") - chatHeight) > 1) throw new Error('Contact dialog changed the chat layout')
    if (!await run("!document.querySelector('.contact-work-sheet').matches(':modal') && document.querySelector('.contact-work-sheet').open")) throw new Error('Contact popup must be non-modal')
    // A portal no longer inherits the main panel's interactive region. Verify the
    // real main-process click-through state, which CDP clicks alone bypass.
    await run("window.__floatingMouseIgnored = null; window.__stopFloatingMouseState = window.electronAPI.onMouseEventsState(value => { window.__floatingMouseIgnored = value }); window.electronAPI.setIgnoreMouseEvents(false)")
    window.webContents.send('cursor-position', { x: -10, y: -10 })
    await waitForRenderer(window, 'window.__floatingMouseIgnored === true')
    const floatingHit = await run("(() => { const el=document.querySelector('[data-contact-dialog-tab=history]'), r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()")
    if (!await run(`Boolean(document.elementFromPoint(${floatingHit.x}, ${floatingHit.y})?.closest('.contact-work-sheet[data-interactive]'))`)) throw new Error('Floating panel is not an interactive hit target')
    window.webContents.send('cursor-position', floatingHit)
    await waitForRenderer(window, 'window.__floatingMouseIgnored === false')
    await run('window.__stopFloatingMouseState(); delete window.__stopFloatingMouseState; delete window.__floatingMouseIgnored')
    await run("document.querySelector('.input-textarea').focus()")
    if (!await run("document.activeElement === document.querySelector('.input-textarea') && document.querySelector('.contact-work-sheet').open")) throw new Error('Floating work panel blocks the chat composer')
    if (!await run("(() => { const r=document.querySelector('.contact-work-sheet').getBoundingClientRect(); return Math.abs(r.left+r.width/2-innerWidth/2)<2 && Math.abs(r.top+r.height/2-innerHeight/2)<2 })()")) throw new Error('Contact popup is not centered after loading')
    const floatingStyle = await run("document.querySelector('.contact-work-sheet').getAttribute('style')")
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    const floatingBefore = await run("document.querySelector('.contact-work-sheet').getBoundingClientRect().toJSON()")
    const listWidthBefore = await run("document.querySelector('.contact-work-sheet .topic-list').getBoundingClientRect().width")
    const pointerDrag = async (x: number, y: number, dx: number, dy: number) => {
      await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
      await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + dx, y: y + dy, button: 'left', buttons: 1 })
      await run('new Promise(resolve => requestAnimationFrame(resolve))')
      await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y: y + dy, button: 'left', buttons: 0, clickCount: 1 })
    }
    await pointerDrag(floatingBefore.x + 100, floatingBefore.y + 15, -30, -20)
    const floatingMoved = await run("document.querySelector('.contact-work-sheet').getBoundingClientRect().toJSON()")
    if (Math.abs(floatingMoved.x - Math.max(8, floatingBefore.x - 30)) > 2 || Math.abs(floatingMoved.y - Math.max(8, floatingBefore.y - 20)) > 2) throw new Error(`Title bar drag did not move the panel: ${JSON.stringify({ floatingBefore, floatingMoved })}`)
    await pointerDrag(floatingMoved.right - 6, floatingMoved.bottom - 6, -70, -50)
    const floatingResized = await run("document.querySelector('.contact-work-sheet').getBoundingClientRect().toJSON()")
    if (Math.abs(floatingResized.width - floatingMoved.width + 70) > 2 || Math.abs(floatingResized.height - floatingMoved.height + 50) > 2) throw new Error('Resize handle did not change both dimensions')
    if (floatingResized.width > 660 && Math.abs(await run("document.querySelector('.contact-work-sheet .topic-list').getBoundingClientRect().width") - listWidthBefore) > 1) throw new Error('Task list width changed with dialog resize')
    await pointerDrag(floatingResized.left + 2, floatingResized.top + floatingResized.height / 2, 24, 0)
    const leftResized = await run("document.querySelector('.contact-work-sheet').getBoundingClientRect().toJSON()")
    if (Math.abs(leftResized.left - floatingResized.left - 24) > 2 || Math.abs(leftResized.right - floatingResized.right) > 2) throw new Error('Left edge resize did not preserve the opposite edge')
    await pointerDrag(leftResized.left + leftResized.width / 2, leftResized.top + 2, 0, 20)
    const topResized = await run("document.querySelector('.contact-work-sheet').getBoundingClientRect().toJSON()")
    if (Math.abs(topResized.top - leftResized.top - 20) > 2 || Math.abs(topResized.bottom - leftResized.bottom) > 2) throw new Error('Top edge resize did not preserve the opposite edge')
    if (!await run("getComputedStyle(document.querySelector('.contact-work-sheet-heading')).cursor === 'default' && document.querySelectorAll('.contact-work-resize').length === 8")) throw new Error('Window edge affordances regressed')
    await run("document.querySelector('.input-textarea').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true,button:0}))")
    if (!await run("(() => { const main=document.querySelector('.chat-panel'), floating=document.querySelector('.contact-work-sheet'), a=main.getBoundingClientRect(), b=floating.getBoundingClientRect(), x=(Math.max(a.left,b.left)+Math.min(a.right,b.right))/2, y=(Math.max(a.top,b.top)+Math.min(a.bottom,b.bottom))/2; return document.elementFromPoint(x,y)?.closest('[data-panel-window]') === main })()")) throw new Error('Overlapping area still sends clicks to the floating panel after activating main')
    if (!await run("Number(getComputedStyle(document.querySelector('.chat-panel')).zIndex) > Number(getComputedStyle(document.querySelector('.contact-work-sheet')).zIndex)")) throw new Error('Main window cannot come in front: ' + await run("JSON.stringify(Array.from(document.querySelectorAll('[data-panel-window]')).map(el=>({kind:el.dataset.panelWindow,active:el.dataset.panelActive,style:el.getAttribute('style'),z:getComputedStyle(el).zIndex,transition:getComputedStyle(el).transition,animations:el.getAnimations().map(a=>a.effect.getKeyframes())})))"))
    await run("document.querySelector('[data-contact-work-tab=work]').click()")
    if (!await run("(() => { const el=document.querySelector('.contact-work-sheet'), r=el.getBoundingClientRect(); return document.elementFromPoint(r.left+r.width/2,r.top+20)?.closest('[data-panel-window]') === el })()")) throw new Error('Floating window did not regain pointer hits after activation')
    if (!await run("document.querySelector('.contact-work-sheet').open && Number(getComputedStyle(document.querySelector('.contact-work-sheet')).zIndex) > Number(getComputedStyle(document.querySelector('.chat-panel')).zIndex)")) throw new Error('Task entry closed the covered panel instead of bringing it forward')
    if (!await run("Array.from(document.querySelectorAll('.contact-work-sheet .topic-card-times')).every(el => el.querySelectorAll('time[datetime]').length === 2)")) throw new Error('Task timestamps are missing')
    await run(`document.querySelector('.contact-work-sheet').setAttribute('style', ${JSON.stringify(floatingStyle)}); delete document.querySelector('.contact-work-sheet').dataset.resized`)
    await waitForRenderer(window, "document.querySelectorAll('.contact-work-sheet [data-topic-change]').length === 4")
    if (!await run("document.querySelector('.contact-work-sheet [data-topic-judgement]').textContent.includes('团队已有免费方案') && document.querySelector('.contact-work-sheet [data-topic-run]').textContent.includes('启动')")) throw new Error('Task dialog did not show the ended topic')
    await run("document.querySelector('.contact-work-sheet .topic-content-tabs [id$=history]').click()")
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet .topic-timeline').getBoundingClientRect().height > 0")
    if (!await run("(() => { const sheet=document.querySelector('.contact-work-sheet'), header=sheet.querySelector('.topic-fixed-header'), scroll=sheet.querySelector('.topic-content-scroll'), before=header.getBoundingClientRect().top; scroll.scrollTop=scroll.scrollHeight; return scroll.scrollTop>0 && Math.abs(header.getBoundingClientRect().top-before)<1 && sheet.querySelectorAll('[data-topic-run], [data-topic-pause]').length===1 })()")) throw new Error('Task controls did not stay fixed while scrolling')
    await run("document.querySelector('.contact-work-sheet [data-topic-settings]').click()")
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet .topic-settings').getBoundingClientRect().height > 0")
    if (!await run("document.querySelector('.contact-work-sheet .topic-settings').textContent.includes('以下调整仅针对当前任务') && document.querySelector('.contact-work-sheet .topic-content-tabs').getBoundingClientRect().height===0")) throw new Error('Task settings are not separate from contact settings')
    await run("document.querySelector('.contact-work-sheet [data-topic-settings]').click(); document.querySelector('.contact-work-sheet .topic-content-tabs [id$=overview]').click()")
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet [data-topic-overview]').getBoundingClientRect().height > 0")
    if (!await run("document.querySelector('.contact-work-sheet [data-topic-tokens]').textContent === '480' && document.querySelector('.contact-work-sheet [data-topic-calls]').textContent.includes('4') && document.querySelector('.contact-work-sheet [data-topic-run] svg') && document.querySelector('.contact-work-sheet [data-topic-settings] svg')")) throw new Error('Overview metrics or task button icons are missing')
    // The only assignment entry is the actual chat composer and model tool execution.
    if (await run("Boolean(document.querySelector('[data-topic-create]') || document.querySelector('[data-agent-goal]'))")) throw new Error('Duplicate task entry remains')
    await run("document.querySelector('[data-agent-chat]').click()")
    await waitForRenderer(window, "!document.querySelector('.contact-work-sheet[open]')")
    scenario = 'assign'; toolStep = 0
    await fill('.input-textarea', '帮我持续核对团队知识库的检索需求，只读验证，预算 500 元')
    await run("document.querySelector('[aria-label=\"发送消息\"]').click()")
    await waitStatus('waiting')
    await waitForRenderer(window, "document.querySelector('.message-area').textContent.includes('团队通常检索什么内容')")
    await waitForRenderer(window, "!document.querySelector('[aria-label=\"停止生成\"]')")
    if (!toolResponses.some(value => value.includes('任务已接下'))) throw new Error('Chat did not dispatch a real contact task')
    await fill('.input-textarea', '保留在聊天输入框中的草稿')
    await run("document.querySelector('[data-contact-work-tab=\"work\"]').click()")
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet [data-topic-current]')?.textContent.includes('研究另一个独立方向') && !document.querySelector('.contact-work-sheet [data-topic-editor]')")
    await run("document.querySelector('.contact-work-sheet [data-topic-pause]').click()")
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet [data-topic-current]')?.textContent.includes('已暂停') && document.querySelector('.contact-work-sheet [data-topic-run]')?.textContent.includes('启动') && !document.querySelector('.contact-work-sheet [data-topic-editor]')")
    if ((await get()).runs.some(r => ['queued', 'running', 'waiting', 'interrupted'].includes(r.status))) throw new Error('Pause left an active run')
    await run(`Array.from(document.querySelectorAll('.contact-work-sheet [data-topic-id]')).find(button => button.dataset.topicId === ${JSON.stringify(topicId)}).click()`)
    if ((await get()).focusTopicId === topicId) throw new Error('Browsing a task changed the scheduling focus')
    await waitForRenderer(window, "document.querySelectorAll('.contact-work-sheet [data-topic-change]').length === 4")
    await run("document.querySelector('[data-contact-dialog-tab=settings]').click(); document.querySelector('.contact-work-sheet .agent-work-settings').open=true")
    await fill('.contact-work-sheet [data-agent-interval]', '181')
    await run("document.querySelector('[data-contact-dialog-tab=\"memory\"]').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet .agent-memories li'))")
    if ((await run("document.querySelector('.contact-work-sheet').textContent")).includes('BOB_PRIVATE_SMOKE')) throw new Error('Chat toolbar exposed another contact memory')
    await run("document.querySelector('[aria-label=\"关闭联系人工作弹窗\"]').click()")
    await waitForRenderer(window, "!document.querySelector('.contact-work-sheet')?.open")
    await run("document.querySelector('[data-contact-work-tab=\"work\"]').click()")
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet[open] [data-agent-interval]')?.value === '181'")
    if (await run("document.querySelector('.input-textarea').value") !== '保留在聊天输入框中的草稿') throw new Error('Toolbar replaced the chat draft')
    await run("document.querySelector('[data-contact-dialog-tab=\"history\"]').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet .agent-record'))")
    await run("document.querySelector('.contact-work-sheet .agent-record > button').click()")
    await waitForRenderer(window, "!document.querySelector('.contact-work-sheet .agent-record') && document.querySelector('.contact-work-sheet .agent-history')?.hidden === false")
    await waitForRenderer(window, "Boolean(document.querySelectorAll('.contact-work-sheet .agent-history button')[1])")
    await run("document.querySelectorAll('.contact-work-sheet .agent-history button')[1].click()")
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet .agent-report'))")
    await run("document.querySelector('[data-contact-dialog-tab=\"work\"]').click(); document.querySelector('.contact-work-sheet .agent-work-settings').open=false")
    if (directory) {
      await run("document.querySelector('[aria-label=\"最大化窗口\"]')?.click()")
      for (const theme of ['light', 'dark']) {
        saveConfig({ theme: theme as 'light' | 'dark' }); window.webContents.send('config:changed', getConfig())
        await run(`document.documentElement.dataset.theme='${theme}'`)
        for (const width of [1024, 375]) {
          window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 768 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, viewSize: { width, height: 768 }, scale: 1 })
          await run("window.dispatchEvent(new Event('resize'))")
          await waitForRenderer(window, `innerWidth === ${width} && document.querySelector('.chat-panel').getBoundingClientRect().width <= ${width + 1}`)
          await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
          await run('new Promise(resolve => setTimeout(resolve, 160))')
          const fits = await run(`(() => { const sheet=document.querySelector('.contact-work-sheet'), content=document.querySelector('.contact-work-sheet-content'), input=document.querySelector('.input-area'); const r=sheet.getBoundingClientRect(), i=input.getBoundingClientRect(); return r.x >= 0 && r.right <= ${width + 1} && content.scrollWidth <= content.clientWidth + 1 && i.bottom <= 769 && i.height > 0 })()`)
          if (!await run("(() => { const sheet=document.querySelector('.contact-work-sheet'), card=sheet.querySelector('[data-topic-id]'), settings=sheet.querySelector('.agent-settings-view'); return sheet.clientHeight < innerHeight - 100 && card.clientHeight < 125 && settings.getBoundingClientRect().height === 0 })()")) throw new Error('Task dialog density or settings separation regressed')
          if (!fits) {
            const bounds = await run("JSON.stringify({ viewport:[innerWidth,innerHeight], panel:document.querySelector('.chat-panel').getBoundingClientRect().toJSON(), sheet:document.querySelector('.contact-work-sheet').getBoundingClientRect().toJSON(), input:document.querySelector('.input-area').getBoundingClientRect().toJSON(), content:[document.querySelector('.contact-work-sheet-content').scrollWidth,document.querySelector('.contact-work-sheet-content').clientWidth] })")
            throw new Error(`Chat work toolbar overflows the viewport or hides the composer: ${bounds}`)
          }
          writeFileSync(join(directory, `chat-work-${theme}-${width}.png`), (await window.webContents.capturePage({ x: 0, y: 0, width, height: 768 }, { stayHidden: true, stayAwake: true })).toPNG())
        }
      }
      window.webContents.disableDeviceEmulation()
    }
    await run("document.querySelector('.contact-work-sheet-heading button').focus()")
    await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await waitForRenderer(window, "!document.querySelector('.contact-work-sheet')?.open && Boolean(document.querySelector('.chat-panel'))")
    await run("document.querySelector('[data-contact-work-tab=\"work\"]').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet[open] [data-topic-evidence]'))")
    await run("document.querySelector('.contact-work-sheet [data-topic-evidence]').click()")
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet .agent-report')?.textContent.includes('团队已有免费方案')")
    await run("document.querySelector('.contact-work-sheet .agent-record > button.primary').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('.agent-composer-reference'))")
    // Change the active contact through the real session event used by the renderer.
    createChatSession('另一个联系人', other.id)
    window.webContents.send('sessions:changed')
    await waitForRenderer(window, `Boolean(document.querySelector('[data-contact-work-tools="${other.id}"]'))`)
    if (await run("Boolean(document.querySelector('.contact-work-sheet'))")) throw new Error('Toolbar kept the previous contact panel mounted')
    if (await run("Boolean(document.querySelector('.agent-composer-reference'))")) throw new Error('Work reference leaked into another contact')
    await run("document.querySelector('[data-contact-work-tab=\"memory\"]').click()")
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet')?.textContent.includes('BOB_PRIVATE_SMOKE')")
    if ((await run("document.querySelector('.contact-work-sheet').textContent")).includes('需求存在的证据')) throw new Error('Toolbar kept previous contact memories')
    selectChatSession(fixtureSession); window.webContents.send('sessions:changed')
    await waitForRenderer(window, `Boolean(document.querySelector('[data-contact-work-tools="${DEFAULT_CHARACTER_ID}"]'))`)
    await run(`window.electronAPI.agents.pause(${id})`)
    await startFeedback('deny')
    await run("document.querySelector('.tool-approval-actions .secondary').click()")
    await finishFeedback()
    if (!toolResponses.some(value => value.includes('用户拒绝'))) throw new Error('Contact tool denial was ignored')
    await startFeedback('stale')
    const beforeStale = await get(), target = beforeStale.topics.find(t => t.id === beforeStale.focusTopicId)!
    await run(`window.electronAPI.agents.editTopic(${id}, ${JSON.stringify(target.id)}, ${target.revision}, ${JSON.stringify({ title: target.title, goal: target.goal, constraints: '确认期间手动变更' })}, '验收过期操作')`)
    await run("document.querySelector('.tool-approval-actions .primary').click()")
    await finishFeedback()
    if (!toolResponses.some(value => value.includes('事项已变化'))) throw new Error('Stale contact confirmation was not rejected')
    await startFeedback('constraints')
    await run("document.querySelector('.tool-approval-actions .primary').click()")
    await finishFeedback()
    if ((await get()).topics.find(t => t.id === target.id)!.constraints !== '仅验证开发者工具，预算 200 元') throw new Error('Confirmed constraints were not saved')
    if (Number(calls) !== 3) throw new Error('Opening the chat toolbar unexpectedly started model work')
    researching = true
    const budgetSettings = (await get()).settings
    await run(`window.electronAPI.agents.savePreferences(${id}, ${JSON.stringify({ ...budgetSettings, dailyCalls: 16 })})`)
    await run("document.querySelector('[data-contact-work-tab=\"work\"]').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet [data-agent-search-key]'))")
    await run("document.querySelector('[data-contact-dialog-tab=settings]').click(); document.querySelector('.contact-work-sheet .agent-work-settings').open=true; document.querySelector('.agent-search-credentials').open=true")
    await fill('[data-agent-search-key]', 'search-smoke-secret')
    await run("document.querySelector('[data-agent-search-key-save]').click()")
    await waitForRenderer(window, "document.querySelector('.agent-search-credentials summary')?.textContent.includes('已配置')")
    await run("document.querySelector('[data-agent-search-enabled]').click()")
    await run("document.querySelector('[data-agent-save]').click()")
    await waitForRenderer(window, "document.querySelector('[data-agent-save]')?.disabled === false && !document.querySelector('.contact-work-sheet').textContent.includes('设置尚未保存')")
    const researchBefore = await get(), researchTopic = researchBefore.topics.find(t => t.id === target.id)!
    if (!researchBefore.settings.searchEnabled) throw new Error('Autonomous search setting was not saved')
    await run(`window.electronAPI.agents.topicStatus(${id}, ${JSON.stringify(target.id)}, ${researchTopic.revision}, 'planned', '补查团队定价')`)
    await run(`window.electronAPI.agents.run(${id}, ${JSON.stringify(target.id)})`)
    const discovered = await waitStatus('completed')
    if (researchCalls !== 2 || discovered.reports[0].evidence[0].url !== 'https://chouyu-agent-smoke.invalid/search-evidence') throw new Error('Autonomous search did not read discovered original evidence')
    await restartAgentsForSmoke()
    await run(`window.electronAPI.agents.run(${id}, ${JSON.stringify(target.id)})`)
    const unchanged = await waitStatus('completed')
    if (Number(researchCalls) !== 3 || unchanged.reports.length !== discovered.reports.length || unchanged.searchesToday !== 2 || unchanged.nextAt < Date.now() + 359 * 60000) throw new Error('Unchanged evidence repeated analysis or lost search accounting/backoff')
    await run("document.querySelector('[data-contact-dialog-tab=\"history\"]').click()")
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet .agent-history button')?.textContent.includes('资料没有变化')")
    await run("document.querySelector('.contact-work-sheet .agent-history button').click()")
    await waitForRenderer(window, "document.querySelector('.agent-research-record')?.textContent.includes('团队 免费 替代品') && document.querySelector('.agent-research-record')?.textContent.includes('资料未变')")
    await run("document.querySelector('.agent-research-record').parentElement.open=true")
    if (directory) {
      await run("document.querySelector('[aria-label=\"最大化窗口\"]')?.click()")
      for (const width of [1024, 375]) {
        window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 900 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, viewSize: { width, height: 900 }, scale: 1 })
        await waitForRenderer(window, `innerWidth === ${width}`)
        await run("window.dispatchEvent(new Event('resize')); document.querySelector('.agent-research-record').scrollIntoView({block:'center'})")
        await run('new Promise(resolve => setTimeout(resolve, 180))')
        const fits = await run(`(() => { const e=document.querySelector('.contact-work-sheet'), r=e.getBoundingClientRect(); return r.x >= 0 && r.right <= ${width + 1} && e.scrollWidth <= e.clientWidth + 1 })()`)
        if (!fits) throw new Error('Research record overflows')
        writeFileSync(join(directory, `agent-research-${width}.png`), (await window.webContents.capturePage({ x: 0, y: 0, width, height: 900 }, { stayHidden: true, stayAwake: true })).toPNG())
      }
      window.webContents.disableDeviceEmulation()
    }
    await run("document.querySelector('[data-contact-dialog-tab=\"work\"]').click()")
    await run("document.querySelector('.topic-content-tabs [id$=delivery]').click()")
    await waitForRenderer(window, "document.querySelector('.contact-delivery')?.clientWidth > 0 && Boolean(document.querySelector('[data-delivery-feedback]'))")
    const beforeRevision = await run(`window.electronAPI.agents.delivery(${id}, ${JSON.stringify(target.id)})`)
    revisedSectionId = beforeRevision.sections[0].id; revisingDelivery = true
    await fill('[data-delivery-feedback]', '明确指出团队付费仍缺乏证据')
    await waitForRenderer(window, "document.querySelector('[data-delivery-submit]')?.disabled === false")
    await run("document.querySelector('[data-delivery-submit]').click()")
    await waitForRenderer(window, `document.querySelector('.contact-delivery')?.dataset.deliveryVersion === '${beforeRevision.version + 1}'`, 20000)
    if (!await run("document.querySelector('.delivery-reader')?.textContent.includes('已按修改意见补充局限')")) throw new Error('Revision form did not update the deliverable')
    await run("document.querySelector('[data-delivery-prev]').click()")
    await waitForRenderer(window, `document.querySelector('.contact-delivery')?.dataset.deliveryVersion === '${beforeRevision.version}'`)
    if (await run("document.querySelector('.delivery-reader')?.textContent.includes('已按修改意见补充局限')")) throw new Error('Old artifact version was overwritten')
    await run("document.querySelector('[data-delivery-next]').click()")
    await waitForRenderer(window, `document.querySelector('.contact-delivery')?.dataset.deliveryVersion === '${beforeRevision.version + 1}'`)
    await run(`window.electronAPI.agents.pause(${id})`)
    console.log('CHOUYU_SMOKE_AGENTS_PASSED utilityProcess=true restart=true calls=3 feedbackRevisionCalls=1 researchCalls=5 isolatedMemory=true evidence=true chatToolbar=true topics=true notices=true deepLinks=true confirmedFeedback=true autonomousResearch=true unchangedBackoff=true deliverableVersions=true export=true revisionForm=true')
  } catch (error) {
    console.error('CHOUYU_AGENT_SMOKE_ERROR', error)
    console.error('CHOUYU_AGENT_UI', await run("document.querySelector('.contact-work-sheet')?.textContent.slice(0, 5000)"))
    throw error
  } finally {
    if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach()
    window.webContents.disableDeviceEmulation()
    await run("document.querySelector('[data-contacts-close]')?.click(); document.querySelector('[aria-label=\"关闭面板\"]')?.click()")
    await waitForRenderer(window, "!document.querySelector('.chat-panel')")
    await run('window.electronAPI.db.getSessionWorkspace()')
    saveConfig(original); window.webContents.send('config:changed', getConfig()); selectChatSession(session); flushDatabase()
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  }
}
