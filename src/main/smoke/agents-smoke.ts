import type { BrowserWindow } from 'electron'
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getConfig, saveConfig, listCharacters, getActiveSession, selectChatSession, flushDatabase, createChatSession } from '../database'
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
  let fixtureSession = ''
  const server = createServer((request, response) => {
    if (request.url === '/v1/models') { response.end(JSON.stringify({ data: [{ id: 'agent-smoke' }] })); return }
    let body = ''; request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      calls++; modelRequest = JSON.parse(body)
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const judgements = ['需求存在，个人付费意愿未知。', '个人用户不愿付费，转向核对团队需求。', '团队已有免费方案，暂时放弃该方向。']
      const nextStep = calls === 3 ? '' : calls === 2 ? '核对团队已有替代方案与替换意愿。' : '按你熟悉的行业继续核对需求证据。'
      const result = { title: `开发者机会研究 · 第 ${calls} 轮`, body: `资料 [1] 的本轮判断：${judgements[calls - 1]}\n以上为研究判断，不能视为已验证收益。`, nextStep, question: calls === 1 ? '你更熟悉哪个行业？' : '', memories: calls === 1 ? ['需求存在的证据不等于付费意愿，下一轮应继续验证。'] : [], progress: { judgement: judgements[calls - 1], openQuestions: calls === 3 ? '是否存在其他细分人群仍未知。' : '谁愿意付费、现有方案是否足够？', nextStep, reason: calls === 1 ? '资料 [1] 提供需求线索，尚未证明付费意愿。' : calls === 2 ? '新资料 [1] 否定了个人用户付费假设，缩小到团队。' : '资料 [1] 显示团队已有免费替代方案，因此停止投入。', status: calls === 3 ? 'abandoned' : 'needs_evidence' } }
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(result) } }] })}\n\ndata: [DONE]\n\n`)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Agent smoke model unavailable')
  const id = JSON.stringify(DEFAULT_CHARACTER_ID)
  const get = () => run(`window.electronAPI.agents.get(${id})`) as Promise<AgentOverview>
  const waitStatus = async (status: string) => {
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) { const result = await get(); if (result.runs[0]?.status === status) return result; if (result.runs[0]?.status === 'failed') throw new Error(result.runs[0].error); await new Promise(r => setTimeout(r, 80)) }
    throw new Error(`Agent status did not become ${status}: ${JSON.stringify((await get()).runs)}`)
  }
  try {
    window.webContents.debugger.attach('1.3')
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    saveConfig({ provider: 'openai', baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'agent-smoke-secret', model: 'agent-smoke', memoryEnabled: false })
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
    await waitForRenderer(window, "Boolean(document.querySelector('[data-agent-goal]'))", 20000)
    console.log('CHOUYU_SMOKE_AGENTS_STAGE editor-ready')
    const fill = async (selector: string, value: string) => {
      await waitForRenderer(window, `Boolean(document.querySelector(${JSON.stringify(selector)}))`)
      return run(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', {bubbles:true})); })()`)
    }
    await fill('[data-agent-goal]', '持续寻找开发者需求，记录证据和待验证的收入机会。')
    await fill('[data-agent-sources]', 'https://chouyu-agent-smoke.invalid/research')
    await run("document.querySelector('[data-agent-save]').click()")
    await waitForRenderer(window, "document.querySelector('[data-agent-run]')?.disabled === false")
    const other = listCharacters().find(c => c.id !== DEFAULT_CHARACTER_ID && c.id !== ASSISTANT_CHARACTER_ID)!
    await run(`window.electronAPI.agents.remember(${JSON.stringify(other.id)}, 'BOB_PRIVATE_SMOKE')`)
    await run("document.querySelector('[data-agent-run]').click()")
    const waiting = await waitStatus('waiting')
    console.log('CHOUYU_SMOKE_AGENTS_STAGE waiting')
    if (calls !== 1 || modelRequest.max_tokens !== 2200 || JSON.stringify(modelRequest).includes('BOB_PRIVATE_SMOKE')) throw new Error('Agent model budget or isolation failed')
    // Kill the utility process at a durable interrupt; replying must not call the model again.
    await restartAgentsForSmoke()
    console.log('CHOUYU_SMOKE_AGENTS_STAGE restarted')
    await waitStatus('waiting')
    await fill('.agent-question textarea', '开发者工具')
    await run("document.querySelector('.agent-question button').click()")
    const completed = await waitStatus('completed')
    console.log('CHOUYU_SMOKE_AGENTS_STAGE completed')
    if (calls !== 1 || completed.reports.length !== 1 || !completed.reports[0].body.includes('开发者工具') || completed.memories.length !== 1) throw new Error('Agent resume duplicated work or lost results')
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
        }
      }
      window.webContents.disableDeviceEmulation()
    }
    await run("document.querySelector('[data-contacts-close]').click(); document.querySelector('[data-workspace-nav=\"chat\"]').click()")
    await waitForRenderer(window, `Boolean(document.querySelector('[data-contact-work-tools="${DEFAULT_CHARACTER_ID}"]'))`)
    await fill('.input-textarea', '保留在聊天输入框中的草稿')
    const chatHeight = await run("document.querySelector('.message-area').getBoundingClientRect().height")
    await run("document.querySelector('[data-contact-work-tab=\"work\"]').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet[open] [data-agent-goal]'))")
    if (Math.abs(await run("document.querySelector('.message-area').getBoundingClientRect().height") - chatHeight) > 1) throw new Error('Contact dialog changed the chat layout')
    if (!await run("document.querySelector('.contact-work-sheet').matches(':modal') && document.querySelector('.contact-work-sheet').contains(document.activeElement)")) throw new Error('Contact popup is not a focused modal')
    await waitForRenderer(window, "document.querySelectorAll('.contact-work-sheet [data-topic-change]').length === 4")
    if (!await run("document.querySelector('.contact-work-sheet [data-topic-judgement]').textContent.includes('团队已有免费方案') && document.querySelector('.contact-work-sheet [data-topic-run]').disabled")) throw new Error('Task dialog did not show the ended topic')
    // Create and pause a second topic through the full form, without a model call.
    await run("document.querySelector('.contact-work-sheet [data-topic-create]').click()")
    await fill('.contact-work-sheet [data-topic-title]', '研究另一个独立方向')
    await fill('.contact-work-sheet [data-topic-goal]', '核对团队知识库的检索需求')
    await fill('.contact-work-sheet [data-topic-constraints]', '只读验证，预算 500 元')
    await run("document.querySelector('.contact-work-sheet [data-topic-save]').click()")
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet [data-topic-current]')?.textContent.includes('研究另一个独立方向') && !document.querySelector('.contact-work-sheet [data-topic-editor]')")
    await run("document.querySelector('.contact-work-sheet [data-topic-pause]').click()")
    await fill('.contact-work-sheet [data-topic-reason]', '先保留方向，等我补充资料')
    await run("document.querySelector('.contact-work-sheet [data-topic-save]').click()")
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet [data-topic-current]')?.textContent.includes('先保留方向，等我补充资料') && !document.querySelector('.contact-work-sheet [data-topic-editor]')")
    await run(`(() => { const select = document.querySelector('.contact-work-sheet [data-topic-select]'); select.value=${JSON.stringify(topicId)}; select.dispatchEvent(new Event('change',{bubbles:true})); })()`)
    await waitForRenderer(window, "document.querySelectorAll('.contact-work-sheet [data-topic-change]').length === 4")
    await run("document.querySelector('.contact-work-sheet .agent-work-settings').open=true")
    await fill('.contact-work-sheet [data-agent-goal]', '尚未保存的联系人工作方向')
    await run("document.querySelector('[data-contact-dialog-tab=\"memory\"]').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet .agent-memories li'))")
    if ((await run("document.querySelector('.contact-work-sheet').textContent")).includes('BOB_PRIVATE_SMOKE')) throw new Error('Chat toolbar exposed another contact memory')
    await run("document.querySelector('[aria-label=\"关闭联系人工作弹窗\"]').click()")
    await waitForRenderer(window, "!document.querySelector('.contact-work-sheet')?.open")
    await run("document.querySelector('[data-contact-work-tab=\"work\"]').click()")
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet[open] [data-agent-goal]')?.value === '尚未保存的联系人工作方向'")
    if (await run("document.querySelector('.input-textarea').value") !== '保留在聊天输入框中的草稿') throw new Error('Toolbar replaced the chat draft')
    await run("document.querySelector('[data-contact-dialog-tab=\"history\"]').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet .agent-history button'))")
    await run("document.querySelector('.contact-work-sheet .agent-history button').click()")
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
          if (!fits) {
            const bounds = await run("JSON.stringify({ viewport:[innerWidth,innerHeight], panel:document.querySelector('.chat-panel').getBoundingClientRect().toJSON(), sheet:document.querySelector('.contact-work-sheet').getBoundingClientRect().toJSON(), input:document.querySelector('.input-area').getBoundingClientRect().toJSON(), content:[document.querySelector('.contact-work-sheet-content').scrollWidth,document.querySelector('.contact-work-sheet-content').clientWidth] })")
            throw new Error(`Chat work toolbar overflows the viewport or hides the composer: ${bounds}`)
          }
          writeFileSync(join(directory, `chat-work-${theme}-${width}.png`), (await window.webContents.capturePage({ x: 0, y: 0, width, height: 768 }, { stayHidden: true, stayAwake: true })).toPNG())
        }
      }
      window.webContents.disableDeviceEmulation()
    }
    await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await waitForRenderer(window, "!document.querySelector('.contact-work-sheet')?.open && Boolean(document.querySelector('.chat-panel'))")
    await run("document.querySelector('[data-contact-work-tab=\"work\"]').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet[open] [data-topic-evidence]'))")
    await run("document.querySelector('.contact-work-sheet [data-topic-evidence]').click()")
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet .agent-report')?.textContent.includes('团队已有免费方案')")
    await run("document.querySelector('[aria-label=\"关闭联系人工作弹窗\"]').click()")
    // Change the active contact through the real session event used by the renderer.
    createChatSession('另一个联系人', other.id)
    window.webContents.send('sessions:changed')
    await waitForRenderer(window, `Boolean(document.querySelector('[data-contact-work-tools="${other.id}"]'))`)
    if (await run("Boolean(document.querySelector('.contact-work-sheet'))")) throw new Error('Toolbar kept the previous contact panel mounted')
    await run("document.querySelector('[data-contact-work-tab=\"memory\"]').click()")
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet')?.textContent.includes('BOB_PRIVATE_SMOKE')")
    if ((await run("document.querySelector('.contact-work-sheet').textContent")).includes('需求存在的证据')) throw new Error('Toolbar kept previous contact memories')
    selectChatSession(fixtureSession); window.webContents.send('sessions:changed')
    await waitForRenderer(window, `Boolean(document.querySelector('[data-contact-work-tools="${DEFAULT_CHARACTER_ID}"]'))`)
    await run(`window.electronAPI.agents.pause(${id})`)
    if (Number(calls) !== 3) throw new Error('Opening the chat toolbar unexpectedly started model work')
    console.log('CHOUYU_SMOKE_AGENTS_PASSED utilityProcess=true restart=true calls=3 isolatedMemory=true evidence=true chatToolbar=true topics=true')
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
