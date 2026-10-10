import { DEFAULT_CHARACTER_ID } from '../../shared/characters'
import { interactionHref } from '../../shared/contact-interactions'
import { app, type BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AgentStore } from '../agents/store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { appendAssistantMessage, getSessions, appendAgentNotice, createCharacter, createChatSession, getConfig, getSession, listCharacters, saveConfig, selectChatSession } from '../database'
import { waitForRenderer } from './storage-smoke'

export async function runContactInteractionsSmoke(window: BrowserWindow) {
  if (process.env.CHOUYU_SMOKE_TEST !== '1') throw new Error('Isolated smoke only')
  const run = (code: string) => window.webContents.executeJavaScript(code)
  await run(`document.querySelector('[aria-label="关闭联系人工作弹窗"]')?.click(); document.querySelector('[data-workspace-nav="chat"]')?.click()`)
  const template = listCharacters().find(c => !c.builtIn) || listCharacters()[0]
  const config = getConfig()
  for (const kind of ['budget', 'budget-success', 'question', 'retry', 'billing'] as const) {
    const character = createCharacter({ ...template, name: `交互验收-${kind}`, model: 'agent-smoke' })
    window.webContents.send('characters:changed')
    const session = createChatSession(`交互验收-${kind}`, character.id).activeSession.id
    const store = new AgentStore(join(app.getPath('userData'), 'contact-agents', 'agents.db'))
    let cardId: string, topicId: string, runId: string
    try {
      store.save(character.id, { ...DEFAULT_AGENT_SETTINGS, goal: '写一篇介绍', dailyCalls: 100 })
      runId = store.createRun(character.id, '')
      topicId = store.getRun(runId)!.topic_id!
      if (kind === 'budget' || kind === 'budget-success') {
        store.allocateTaskBudget(runId, { modelCalls: 3, reason: '验收' })
        store.charge(runId); store.charge(runId)
        store.finish(runId, { runId, title: '介绍初稿', body: '正文已经保存。', nextStep: '继续', evidence: [], createdAt: Date.now() }, [], { judgement: '已交稿', nextStep: '继续', openQuestions: '', reason: '实际交付', status: 'researching' })
      } else if (kind === 'question') store.wait(runId, '这篇介绍主要写给谁看？')
      else store.fail(runId, kind === 'billing' ? 'API error 429: 余额不足或无可用资源包' : '验收中的模型输出格式错误')
      const notice = store.notices.pending(character.id).find(n => n.interactionId)!
      cardId = notice.interactionId!
      appendAgentNotice(notice); store.notices.ack(character.id, notice.id)
    } finally { store.close() }
    selectChatSession(session); window.webContents.send('sessions:changed')
    let selector = `[data-contact-interaction="${cardId!}"]`
    try { await waitForRenderer(window, `Boolean(document.querySelector(${JSON.stringify(selector)})?.querySelector('button[type=submit]'))`, 10000) } catch (error) { console.error('INTERACTION_UI', await run('document.body.innerText')); throw error }
    const pendingBefore = await run(`window.electronAPI.agents.pendingInteractions(${JSON.stringify(character.id)})`)
    if (!pendingBefore.some((item: { id: string }) => item.id === cardId)) throw new Error('Pending entry omitted an unresolved decision')
    await run(`window.electronAPI.db.markSessionRead(${JSON.stringify(session)})`)
    const pendingAfterRead = await run(`window.electronAPI.agents.pendingInteractions(${JSON.stringify(character.id)})`)
    if (pendingAfterRead.length !== pendingBefore.length) throw new Error('Reading a message resolved its decision')
    if (kind === 'question') {
      appendAssistantMessage(`这项工作需要你补充：[处理](${interactionHref(character.id, cardId!)})`, undefined, 'notification', { receiptIds: ['interaction-summary-fixture'], messageId: 'interaction-summary-fixture' })
      const assistantSession = getSessions().find(s => s.characterId === DEFAULT_CHARACTER_ID && getSession(s.id)?.messages.some(m => m.id === 'interaction-summary-fixture'))!
      selectChatSession(assistantSession.id); window.webContents.send('sessions:changed')
      await waitForRenderer(window, `Boolean(document.querySelector('[data-contact-pending="${DEFAULT_CHARACTER_ID}"]'))`)
      await waitForRenderer(window, `Boolean(document.querySelector(${JSON.stringify(selector)})?.querySelector('textarea'))`)
      await run(`document.querySelector('[data-contact-pending="${DEFAULT_CHARACTER_ID}"]').click()`)
      selector = '.contact-pending-dialog ' + selector
      await waitForRenderer(window, `Boolean(document.querySelector(${JSON.stringify(selector)})?.querySelector('textarea'))`)
      if (process.env.CHOUYU_SMOKE_ARTIFACTS) {
        for (const theme of ['light', 'dark'] as const) {
          saveConfig({ theme }); window.webContents.send('config:changed', getConfig())
          await new Promise(resolve => setTimeout(resolve, 700))
          for (const width of [375, 1024]) {
            window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 900 }, viewPosition: { x: 0, y: 0 }, viewSize: { width, height: 900 }, deviceScaleFactor: 1, scale: 1 })
            await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
            const inside = await run(`(() => {const r=document.querySelector('.contact-pending-dialog').getBoundingClientRect();return r.left>=0 && r.top>=0 && r.right<=innerWidth+1 && r.bottom<=innerHeight+1})()`)
            if (!inside) throw new Error('Pending dialog escaped the viewport')
            writeFileSync(join(process.env.CHOUYU_SMOKE_ARTIFACTS, `contact-pending-${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG())
          }
        }
        window.webContents.disableDeviceEmulation()
      }
    }
    const fill = async (control: string, value: string) => run(`(() => {const el=document.querySelector(${JSON.stringify(selector + ' ' + control)});Object.getOwnPropertyDescriptor(${control === 'textarea' ? 'HTMLTextAreaElement' : 'HTMLInputElement'}.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`)
    if (kind === 'budget-success') {
      await fill('input', '12')
      const database = new AgentStore(join(app.getPath('userData'), 'contact-agents', 'agents.db'))
      try { database.db.exec(`CREATE TRIGGER interaction_failure BEFORE INSERT ON runs WHEN NEW.character_id='${character.id}' BEGIN SELECT RAISE(ABORT,'interaction disk failure fixture'); END`) } finally { database.close() }
      await run(`document.querySelector(${JSON.stringify(selector)}).querySelector('button[type=submit]').click()`)
      await waitForRenderer(window, `document.querySelector(${JSON.stringify(selector)})?.textContent.includes('interaction disk failure fixture')`)
      if (await run(`document.querySelector(${JSON.stringify(selector)}).querySelector('input').value`) !== '12') throw new Error('Failure erased the budget input')
      const recovered = new AgentStore(join(app.getPath('userData'), 'contact-agents', 'agents.db'))
      try {
        if (recovered.topics.get(character.id, topicId!).resourceBudget?.modelCalls !== 3) throw new Error('Failed submit changed budget')
        recovered.db.exec('DROP TRIGGER interaction_failure')
      } finally { recovered.close() }
      await run(`(() => {const b=document.querySelector(${JSON.stringify(selector)}).querySelector('button[type=submit]');b.click();b.click()})()`)
      await waitForRenderer(window, `document.querySelector(${JSON.stringify(selector)})?.textContent.includes('额度已调整，任务已排队')`, 10000)
      const latest = await run(`window.electronAPI.agents.topicDetail(${JSON.stringify(character.id)},${JSON.stringify(topicId!)})`)
      if (latest.topic.resourceBudget.modelCalls !== 12) throw new Error('Budget card did not save the entered limit')
    } else if (kind === 'budget') {
      await fill('input', '12')
      if (process.env.CHOUYU_SMOKE_ARTIFACTS) {
        const directory = process.env.CHOUYU_SMOKE_ARTIFACTS; mkdirSync(directory, { recursive: true })
        for (const theme of ['light', 'dark'] as const) {
          saveConfig({ theme }); window.webContents.send('config:changed', getConfig())
          await new Promise(resolve => setTimeout(resolve, 700))
          for (const width of [375, 1024]) {
            window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 900 }, viewPosition: { x: 0, y: 0 }, viewSize: { width, height: 900 }, deviceScaleFactor: 1, scale: 1 })
            await run(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
            const geometry = await run(`(() => { const card=document.querySelector(${JSON.stringify(selector)}); const input=card.querySelector('input');input.focus();return {card:card.getBoundingClientRect().right,width:innerWidth,outline:getComputedStyle(input).outlineStyle}; })()`)
            if (geometry.card > geometry.width + 1 || geometry.outline !== 'none') throw new Error('Interaction card overflows or decorates field focus')
            writeFileSync(join(directory, `contact-interaction-${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG())
          }
        }
        window.webContents.disableDeviceEmulation()
      }
      // A real task revision invalidates the displayed card; input must survive the rejected submit.
      const latest = await run(`window.electronAPI.agents.topicDetail(${JSON.stringify(character.id)},${JSON.stringify(topicId!)})`)
      await run(`window.electronAPI.agents.setTaskBudget(${JSON.stringify(character.id)},${JSON.stringify(topicId!)},${latest.topic.revision},{modelCalls:4})`)
      await run(`document.querySelector(${JSON.stringify(selector)}).querySelector('form')?.requestSubmit()`)
      await waitForRenderer(window, `Boolean(document.querySelector(${JSON.stringify(selector)})?.querySelector('.contact-interaction-result'))`)
    } else if (kind === 'billing') {
      const text = await run(`document.querySelector(${JSON.stringify(selector)}).textContent`)
      if (!text.includes('模型服务商') || text.includes('API error')) throw new Error('Billing card exposes raw error instead of useful guidance')
      await run(`Array.from(document.querySelector(${JSON.stringify(selector)}).querySelectorAll('button')).find(b=>b.textContent==='模型服务设置').click()`)
      await waitForRenderer(window, `!document.querySelector('.workspace-settings').hidden`)
      const card = await run(`window.electronAPI.agents.getInteraction(${JSON.stringify(character.id)},${JSON.stringify(cardId!)})`)
      if (card.status !== 'pending') throw new Error('Opening settings falsely resolved billing')
      await run(`document.querySelector('[data-workspace-nav="chat"]').click()`)
    } else {
      if (kind === 'question') await fill('textarea', '主要写给刚开始学习的人')
      await run(`(() => {const b=document.querySelector(${JSON.stringify(selector)}).querySelector('button[type=submit]');b.click();b.click()})()`)
      await waitForRenderer(window, `document.querySelector(${JSON.stringify(selector)})?.textContent.includes('已排队')`, 10000)
      const overview = await run(`window.electronAPI.agents.get(${JSON.stringify(character.id)})`)
      if (kind === 'retry' && overview.runs.length !== 2) throw new Error('Repeated click created duplicate retries')
      if (kind === 'question' && !overview.runs.some((r: { id: string; answer: string }) => r.id === runId && r.answer === '主要写给刚开始学习的人')) throw new Error('Reply did not bind to original round')
    }
    if (kind === 'question') {
      await run(`document.querySelector('[aria-label="关闭待处理事项"]').click()`)
      selectChatSession(session); window.webContents.send('sessions:changed')
      const original = `[data-contact-interaction="${cardId!}"]`
      await waitForRenderer(window, `document.querySelector(${JSON.stringify(original)})?.textContent.includes('已排队')`)
      const pending = await run(`window.electronAPI.agents.pendingInteractions(${JSON.stringify(character.id)})`)
      if (pending.some((item: { id: string }) => item.id === cardId)) throw new Error('Answered item remains pending')
    }
    if (!getSession(session)?.messages.some(m => m.agentNotice?.interactionId === cardId!)) throw new Error('Interaction reference was not persisted in chat')
    await run(`window.electronAPI.agents.pause(${JSON.stringify(character.id)})`)
  }
  saveConfig(config); window.webContents.send('config:changed', getConfig())
  console.log('CHOUYU_CONTACT_INTERACTIONS_PASSED directReply=true retryDedup=true staleBudget=true budgetResume=true rollbackInput=true persisted=true summaryReply=true pendingRead=true billingSettings=true')
}
