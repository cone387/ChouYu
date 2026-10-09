import type { BrowserWindow } from 'electron'
import { createServer } from 'node:http'
import { getConfig, saveConfig, getState, setState } from '../database'
import { waitForRenderer } from './storage-smoke'
import { snapshots } from './chat-smoke'

/** Real UI/IPC/storage with a local model fixture; never calls a paid model. */
export async function runAssistantRoutinesSmoke(window: BrowserWindow) {
  const config = getConfig()
  const run = (script: string) => window.webContents.executeJavaScript(script)
  let fail = false
  let comparisonContact = ''
  let chatSession = ''
  let summarySession = ''
  const server = createServer((request, response) => {
    if (request.method === 'GET') { response.end(JSON.stringify({ data: [{ id: 'smoke-natural' }] })); return }
    let body = ''
    request.on('data', chunk => { body += chunk.toString() })
    request.on('end', () => {
      const payload = JSON.parse(body)
      const respond = (result: string) => {
        response.setHeader('Content-Type', 'text/event-stream')
        response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: result } }] })}\n\ndata: [DONE]\n\n`)
      }
      // The agent child also posts plain-text briefing prompts here; answering them
      // benignly keeps an uncaught JSON.parse from killing the smoke process.
      let context: { evidence?: unknown; target?: { kind?: string }; capabilities?: { scheduled?: boolean }; existing?: { title: string; instruction: string; cadence: string; weekday?: number; kind: string; enabled: boolean }; conversation?: unknown[]; description?: string }
      try { context = JSON.parse(payload.messages.at(-1).content) } catch { return respond('收到，我会处理好。') }
      const onceMatch = /(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/.exec(context.description ?? '')
      const result = context.evidence ? '对照联系人的任务已建立，目前尚未执行。' : fail ? 'invalid-json'
        : context.target?.kind === 'edit-duty' ? JSON.stringify({ kind: 'duty', params: { proactiveReturnAwayMinutes: 15 } })
        : context.target?.kind === 'edit-work' ? JSON.stringify({ kind: 'work-edit', input: { goal: context.description, constraints: '' }, budget: { modelCalls: 20 } })
        : context.target?.kind === 'create' && !context.capabilities?.scheduled
          ? context.description?.includes('持续跟进')
            ? JSON.stringify({ kind: 'work', description: '持续跟进新产品资料并整理进展' })
            : JSON.stringify({ kind: 'routine', input: { title: '喝水提醒', instruction: '提醒喝水', times: ['08:00'], cadence: 'daily', kind: 'reminder', enabled: true } })
        : context.existing ? JSON.stringify({ kind: 'routine', input: { title: context.existing.title, instruction: context.existing.instruction, times: ['09:00'], cadence: context.existing.cadence, weekday: context.existing.weekday, kind: context.existing.kind, enabled: context.existing.enabled } })
        : context.conversation?.length ? JSON.stringify({ kind: 'routine', input: { title: '联系人晨间总结', instruction: '汇总联系人进展和待答复事项', times: ['08:30'], cadence: 'weekdays', kind: 'contact-summary', enabled: true } })
        : context.description?.includes('两个时刻') ? JSON.stringify({ kind: 'routine', input: { title: '早晚提醒', instruction: '提醒喝水', times: ['08:30', '20:00'], cadence: 'daily', kind: 'reminder', enabled: true } })
        : onceMatch ? JSON.stringify({ kind: 'routine', input: { title: '交报告', instruction: '提醒交报告', times: [onceMatch[2]], cadence: 'once', date: onceMatch[1], kind: 'reminder', enabled: true } })
        : JSON.stringify({ kind: 'question', question: '每个工作日早上几点汇报？' })
      respond(result)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  saveConfig({ aiToolsEnabled: true, provider: 'openai', baseUrl: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/v1`, apiKey: 'smoke-key', model: 'smoke-natural', proactiveGreeting: false, proactiveRestReminder: false, proactiveReturn: false })
  window.webContents.send('config:changed', getConfig())
  const fill = (value: string) => run(`(() => { const input = document.querySelector('[data-task-description]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  const submit = () => run("document.querySelector('[data-task-dialog-submit]').click()")
  const uiSignature = () => run(`(() => {
    const root = document.querySelector('.contact-work-sheet[open]');
    const card = root.querySelector('.topic-list-card[aria-current=true]');
    return JSON.stringify({
      tabs: [...root.querySelectorAll('.topic-content-tabs [role=tab]')].map(el => el.textContent),
      actions: [...root.querySelectorAll('.topic-floating-action button')].map(el => ({ icon: !!el.querySelector('svg'), primary: el.classList.contains('primary') })),
      overview: root.querySelector('[data-topic-overview]')?.firstElementChild?.className,
      card: ['.topic-card-title', '.topic-badges', '.topic-card-summary'].map(selector => !!card.querySelector(selector)),
      settings: !!root.querySelector('[data-topic-settings]')
    });
  })()`)
  const openEditor = async (root: string) => {
    await run(`document.querySelector('${root} [data-topic-settings]').click()`)
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-task-dialog:modal'))")
  }
  // Gateway submits keep the panel busy until its agents refresh lands; wait for controls to re-enable before clicking.
  const enabled = (selector: string) => waitForRenderer(window, `!document.querySelector('${selector}')?.disabled`, 20000)

  try {
    window.webContents.send('open-assistant-chat')
    await waitForRenderer(window, "Boolean(document.querySelector('[data-contact-work-tab=work]'))")
    // Ambient renderer saves and routine deliveries always touch the latest assistant
    // session. Move to a throwaway chat session first so the migrated fixture — whose
    // message list the script verifies after exit — is never written to again.
    chatSession = (await run("window.electronAPI.db.createSession('Routine smoke chat', 'chouyu')")).activeSession.id
    window.webContents.send('sessions:changed')
    await waitForRenderer(window, "document.querySelector('.conversation-item-main[aria-selected=true]')?.getAttribute('title') === 'Routine smoke chat'")
    await run("document.querySelector('[data-contact-work-tab=work]').click()")
    await waitForRenderer(window, "document.querySelectorAll('.contact-work-sheet [data-assistant-task]').length === 4", 20000)
    if (await run("Boolean(document.querySelector('.contact-work-sheet .assistant-routines'))")) throw new Error('Separate assistant task UI is still present')
    await snapshots(window, 'assistant-unified-list', '.contact-work-sheet .topic-workspace')
    await run("document.querySelector('.contact-work-sheet [data-topic-create]').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-task-dialog:modal'))")
    if (await run("document.querySelectorAll('.contact-task-dialog input, .contact-task-dialog select, .contact-task-dialog textarea').length !== 1")) throw new Error('Task creation must use one natural-language field')
    await run("document.querySelector('[data-task-description]').focus()")
    if (await run("(() => { const s = getComputedStyle(document.querySelector('[data-task-description]')); return s.outlineStyle !== 'none' || s.boxShadow !== 'none' })()")) throw new Error('Task field has focus decoration')
    await fill('每个工作日早上汇总联系人进展')
    await snapshots(window, 'assistant-natural-form', '.contact-task-dialog')
    fail = true
    await submit()
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-task-dialog [role=alert]'))")
    if ((await run('window.electronAPI.assistantRoutines.list()')).length) throw new Error('Failed parse created schedule')
    if (!(await run("document.querySelector('[data-task-description]').value"))) throw new Error('Failure cleared user input')
    fail = false
    await submit()
    await waitForRenderer(window, "document.querySelector('.contact-task-dialog [role=status]')?.textContent.includes('几点')")
    if ((await run('window.electronAPI.assistantRoutines.list()')).length) throw new Error('Question created schedule')
    if (!await run("document.querySelector('.task-request-context')?.textContent.includes('每个工作日早上汇总联系人进展')")) throw new Error('Clarification lost original request')
    await snapshots(window, 'task-clarification', '.contact-task-dialog')
    await fill('八点半')
    await submit()
    await waitForRenderer(window, "!document.querySelector('.contact-task-dialog') && document.querySelector('.contact-work-sheet .topic-detail-pane')?.textContent.includes('08:30')", 20000)
    const [item] = await run('window.electronAPI.assistantRoutines.list()')
    if (item.times.join() !== '08:30' || item.cadence !== 'weekdays') throw new Error('Natural schedule not persisted')
    if (await run("Boolean(document.querySelector('.contact-work-sheet .topic-metrics'))")) throw new Error('Schedule displays empty metric cards')
    const assistantSignature = await uiSignature()
    if (JSON.parse(assistantSignature).tabs.length !== 5) throw new Error('Scheduled task does not use the shared five-tab navigation')
    for (const suffix of ['stages', 'delivery', 'interactions', 'history', 'overview']) {
      await run(`document.querySelector('.contact-work-sheet .topic-content-tabs [id$=${suffix}]').click()`)
      await waitForRenderer(window, `document.querySelector('.contact-work-sheet [id$=${suffix}-panel]')?.hidden === false`)
    }
    await snapshots(window, 'assistant-natural-saved', '.contact-work-sheet .topic-detail-pane')
    await run("[...document.querySelectorAll('.contact-work-sheet .topic-detail-pane button')].find(b => b.textContent === '暂停').click()")
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet .topic-detail-pane')?.textContent.includes('已暂停')")
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet [data-topic-run]')?.textContent.includes('启用定时')", 10000)
    await openEditor('.contact-work-sheet')
    await fill('改成九点')
    await submit()
    await waitForRenderer(window, "!document.querySelector('.contact-task-dialog') && document.querySelector('.contact-work-sheet .topic-detail-pane')?.textContent.includes('09:00')")
    const updated = await run('window.electronAPI.assistantRoutines.list()')
    if (updated.length !== 1 || updated[0].id !== item.id || updated[0].enabled) throw new Error('Edit duplicated task or changed pause state')
    // 多时段:一次创建,两个时刻各自送达
    await enabled('.contact-work-sheet [data-topic-create]')
    await run("document.querySelector('.contact-work-sheet [data-topic-create]').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-task-dialog:modal'))")
    await fill('每天早晚两个时刻提醒我喝水')
    await submit()
    await waitForRenderer(window, "!document.querySelector('.contact-task-dialog')", 20000)
    const multi = (await run('window.electronAPI.assistantRoutines.list()')).find((entry: { title: string }) => entry.title === '早晚提醒')
    if (!multi || multi.times.join() !== '08:30,20:00') throw new Error('Multi-time schedule not persisted')
    // 一次性:稍后时刻。Round up to the next full minute — the validator compares against
    // HH:mm:00, so a truncated now+N could land in the already-started minute.
    await enabled('.contact-work-sheet [data-topic-create]')
    await run("document.querySelector('.contact-work-sheet [data-topic-create]').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-task-dialog:modal'))")
    const soon = new Date(Math.ceil((Date.now() + 20_000) / 60_000) * 60_000)
    const onceDate = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`
    const onceTime = `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`
    await fill(`一次性任务:${onceDate} ${onceTime} 提醒我交报告`)
    await submit()
    await waitForRenderer(window, "!document.querySelector('.contact-task-dialog')", 20000)
    const once = (await run('window.electronAPI.assistantRoutines.list()')).find((entry: { cadence?: string }) => entry.cadence === 'once')
    if (!once || once.date !== onceDate || once.times.join() !== onceTime) throw new Error('Once schedule not persisted')
    // 草稿续传:追问后关窗,重开恢复上下文
    await enabled('.contact-work-sheet [data-topic-create]')
    await run("document.querySelector('.contact-work-sheet [data-topic-create]').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-task-dialog:modal'))")
    await fill('每个工作日早上汇总联系人进展')
    await submit()
    await waitForRenderer(window, "document.querySelector('.contact-task-dialog [role=status]')?.textContent.includes('几点')")
    await enabled('.contact-task-dialog [type=button]')
    await run("document.querySelector('.contact-task-dialog [type=button]').click()")
    await waitForRenderer(window, "!document.querySelector('.contact-task-dialog')")
    await enabled('.contact-work-sheet [data-topic-create]')
    await run("document.querySelector('.contact-work-sheet [data-topic-create]').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-task-dialog:modal')) && Boolean(document.querySelector('.task-request-context'))", 10000)
    if (!await run("document.querySelector('.task-request-context')?.textContent.includes('每个工作日早上汇总联系人进展')")) throw new Error('Draft not restored after reopen')
    await enabled('.contact-task-dialog [type=button]')
    await run("document.querySelector('.contact-task-dialog [type=button]').click()")
    // duty 参数:打开回来时打招呼,改成离开 15 分钟
    await enabled('.contact-work-sheet .topic-list-card')
    await run("[...document.querySelectorAll('.contact-work-sheet .topic-list .topic-list-card')].find(b => b.textContent.includes('回来时打招呼')).click()")
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet .topic-detail-pane h4')?.textContent.includes('回来时打招呼')")
    await enabled('.contact-work-sheet [data-topic-settings]')
    await openEditor('.contact-work-sheet')
    await fill('离开 15 分钟才算回来')
    await submit()
    await waitForRenderer(window, "!document.querySelector('.contact-task-dialog')", 20000)
    if (getConfig().proactiveReturnAwayMinutes !== 15) throw new Error('Duty parameter not applied')
    await run("document.querySelector('[aria-label=\"关闭联系人工作弹窗\"]').click(); document.querySelector('[data-workspace-nav=settings]').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('[data-settings-nav]'))")
    await run("[...document.querySelectorAll('[data-settings-nav]')].find(b => b.textContent.trim() === '通用').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('#settings-assistant-routines .topic-workspace'))", 20000)
    await waitForRenderer(window, `Boolean(document.querySelector('[data-assistant-task="routine:${item.id}"]'))`)
    await run(`document.querySelector('[data-assistant-task="routine:${item.id}"]').click()`)
    await waitForRenderer(window, "document.querySelector('#settings-assistant-routines .topic-detail-pane')?.textContent.includes('09:00')")
    await openEditor('#settings-assistant-routines')
    await run("document.querySelector('.contact-task-dialog').requestClose()")
    await waitForRenderer(window, "!document.querySelector('.contact-task-dialog')")
    await run(`document.querySelector('#settings-assistant-routines [data-task-menu="routine:${item.id}"]').click()`)
    await run("document.querySelector('#settings-assistant-routines [data-task-delete]').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-task-dialog:modal'))")
    await submit()
    await waitForRenderer(window, "!document.querySelector('.contact-task-dialog')")
    if ((await run('window.electronAPI.assistantRoutines.list()')).some((entry: { id: string }) => entry.id === item.id)) throw new Error('Shared delete dialog did not remove schedule')
    const contact = await run("window.electronAPI.characters.create({ name: 'UI 对照联系人', model: 'smoke-natural', soulMd: '仅用于界面对照' })")
    comparisonContact = contact.id
    const work = await run(`window.electronAPI.agents.createTopic(${JSON.stringify(contact.id)}, {title:'对照任务',goal:'核对公共任务界面',constraints:''})`)
    const topicId = work.topics[0].id
    await run("document.querySelector('[data-workspace-nav=contacts]').click()")
    await waitForRenderer(window, `Boolean(document.querySelector('[data-contacts-item="${contact.id}"]'))`)
    await run(`document.querySelector('[data-contacts-item="${contact.id}"]').click()`)
    await waitForRenderer(window, `Boolean(document.querySelector('[data-character-bar="${contact.id}"]'))`)
    await run("document.querySelector('[data-contact-work-tab=work]').click()")
    await waitForRenderer(window, `Boolean(document.querySelector('.contact-work-sheet[open] [data-topic-id="${topicId}"]'))`)
    await run(`document.querySelector('.contact-work-sheet[open] [data-topic-id="${topicId}"]').click()`)
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet[open] [data-topic-overview]'))")
    if (await uiSignature() !== assistantSignature) throw new Error('ChouYu schedule and other contact task use different UI structures')
    await snapshots(window, 'contact-shared-task', '.contact-work-sheet[open] .topic-detail-pane')
    // 对照联系人:work 编辑+预算经网关;定点请求诚实追问不改写;非定时创建仍走网关
    await enabled('.contact-work-sheet[open] [data-topic-settings]')
    await run("document.querySelector('.contact-work-sheet[open] [data-topic-settings]').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-task-dialog:modal'))")
    await fill('目标改为对照新版任务界面，预算调到 20 次')
    await submit()
    await waitForRenderer(window, "!document.querySelector('.contact-task-dialog')", 20000)
    const edited = await run(`window.electronAPI.agents.get(${JSON.stringify(contact.id)})`)
    const editedTopic = edited.topics.find((t: { id: string }) => t.id === topicId)
    if (!editedTopic.goal.includes('对照新版任务界面')) throw new Error('Work edit not parsed')
    if (editedTopic.resourceBudget?.modelCalls !== 20) throw new Error('NL budget not applied')
    const scheduledBefore = await run('window.electronAPI.assistantRoutines.list().then(items => items.length)')
    await enabled('.contact-work-sheet[open] [data-topic-create]')
    await run("document.querySelector('.contact-work-sheet[open] [data-topic-create]').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-task-dialog:modal'))")
    await fill('每天八点提醒我喝水')
    await submit()
    await waitForRenderer(window, "document.querySelector('.contact-task-dialog [role=status]')?.textContent.includes('定点安排')")
    if (await run('window.electronAPI.assistantRoutines.list().then(items => items.length)') !== scheduledBefore) throw new Error('Scheduled request silently created a routine for a non-scheduled contact')
    await fill('那就持续跟进新产品资料')
    await submit()
    await waitForRenderer(window, "!document.querySelector('.contact-task-dialog')", 20000)
    const afterCreate = await run(`window.electronAPI.agents.get(${JSON.stringify(contact.id)})`)
    if (!afterCreate.topics.some((t: { goal: string }) => t.goal.includes('持续跟进'))) throw new Error('Non-scheduled create not routed through gateway')

    // Execute a real scheduled summary, then follow its durable history/chat/task links.
    // The once routine fires meanwhile; confirm it completed before the summary session
    // exists, so its delivery cannot pollute the summary session.
    await waitForRenderer(window, `window.electronAPI.assistantRoutines.list().then(items => items.some(entry => entry.cadence === 'once' && entry.finishedAt))`, 120000)
    summarySession = (await run("window.electronAPI.db.createSession('Routine smoke delivery', 'chouyu')")).activeSession.id
    await run("document.querySelector('.contact-work-sheet[open] [aria-label=\"关闭联系人工作弹窗\"]').click()")
    const executed = (await run("window.electronAPI.assistantRoutines.save({title:'晨报跳转验收',instruction:'汇总联系人进展',times:['08:30'],cadence:'daily',kind:'contact-summary',enabled:true})")).find((entry: { title: string }) => entry.title === '晨报跳转验收')
    const schedules = JSON.parse(getState('assistant-routines-v1')!)
    schedules.find((entry: {id: string}) => entry.id === executed.id).nextAt = Date.now() - 1000
    setState('assistant-routines-v1', JSON.stringify(schedules))
    await waitForRenderer(window, `window.electronAPI.assistantRoutines.history(${JSON.stringify(executed.id)}).then(page => page.items.some(entry => entry.status === 'completed' && entry.messageId && entry.sessionId))`, 35000)
    window.webContents.send('open-chat-panel')
    await run("document.querySelector('[data-workspace-nav=chat]').click()")
    // Select the known summary through the sidebar. The global unread command
    // intentionally chooses the oldest unread contact, not necessarily ChouYu.
    window.webContents.send('sessions:changed')
    await waitForRenderer(window, "Boolean(document.querySelector('.conversation-item-main[title=\"Routine smoke delivery\"]'))")
    await run("document.querySelector('.conversation-item-main[title=\"Routine smoke delivery\"]').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('[data-character-bar=chouyu]'))")
    await run("document.querySelector('[data-contact-work-tab=work]').click()")
    await waitForRenderer(window, `Boolean(document.querySelector('.contact-work-sheet[open] [data-assistant-task="routine:${executed.id}"]'))`)
    await run(`document.querySelector('.contact-work-sheet[open] [data-assistant-task="routine:${executed.id}"]').click()`)
    await waitForRenderer(window, `document.querySelector('.contact-work-sheet[open] [data-topic-current]')?.dataset.topicCurrent === 'routine:${executed.id}'`)
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await run("document.querySelector('.contact-work-sheet[open] .topic-content-tabs [id$=history]').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet[open] [data-routine-message]'))")
    await snapshots(window, 'routine-execution-history', '.contact-work-sheet[open] .topic-detail-pane')
    await run("document.querySelector('.contact-work-sheet[open] [data-routine-message]').click()")
    await waitForRenderer(window, "document.querySelector('.message-search-summary')?.textContent.includes('这次任务') && document.querySelectorAll('.message-area a[href^=\"#contact-task?\"]').length > 0")
    await snapshots(window, 'morning-summary-message', '.message-area')
    // The failed follow-up run lands its link in the waiting section first, so target the shared task's link by id.
    await run(`[...document.querySelectorAll('.message-area a[href^="#contact-task?"]')].find(a => a.getAttribute('href')?.includes('topicId=' + ${JSON.stringify(topicId)}))?.click()`)
    await waitForRenderer(window, `Boolean(document.querySelector('.contact-work-sheet[open] [data-topic-current="${topicId}"]'))`)
    if (!await run("document.querySelector('.contact-work-sheet[open]')?.textContent.includes('UI 对照联系人')")) throw new Error('Morning summary opened the wrong contact')
    if (await run(`(() => {
      let failed = false;
      const capture = () => { failed = true };
      window.addEventListener('error', capture);
      window.dispatchEvent(new Event('resize'));
      window.removeEventListener('error', capture);
      return failed;
    })()`)) throw new Error('Contact window resize raised an uncaught error')
    await snapshots(window, 'morning-summary-task-link', '.contact-work-sheet[open]')
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet[open] [data-agent-chat]')?.getClientRects().length > 0")
    await run("document.querySelector('.contact-work-sheet[open] [data-agent-chat]').click()")
    await waitForRenderer(window, `Boolean(document.querySelector('[data-character-bar="${contact.id}"]')) && !document.querySelector('.contact-work-sheet[open]')`)
    window.webContents.send('open-chat-panel')
    await run("document.querySelector('[data-workspace-nav=chat]').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('.conversation-item-main[title=\"Routine smoke delivery\"]'))")
    await run("document.querySelector('.conversation-item-main[title=\"Routine smoke delivery\"]').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('[data-character-bar=chouyu]')) && Boolean(document.querySelector('.message-area a[href^=\"#contact-task?\"]'))")

    await run(`window.electronAPI.characters.remove(${JSON.stringify(comparisonContact)})`)
    comparisonContact = ''
    await run("document.querySelector('.message-area a[href^=\"#contact-task?\"]').click()")
    await waitForRenderer(window, "[...document.querySelectorAll('[role=alert]')].some(el => el.textContent.includes('已删除'))")
    if (await run("Boolean(document.querySelector('.contact-work-sheet[open]'))")) throw new Error('Deleted task link opened a different task')

    console.log('CHOUYU_ASSISTANT_ROUTINES_SMOKE_PASSED shared UI/single input/clarification context/save/pause/edit/settings/delete/no focus decoration/multi-time/once completion/draft restore/duty params/work edit with budget/honest scheduled refusal/real scheduled delivery/durable history/message navigation/cross-contact task and chat/deleted link feedback')
  } catch (error) {
    console.log('ROUTINE_UI_FAILURE', 'SHEET:', await run("[...document.querySelectorAll('.contact-work-sheet[open]')].map(el=>el.innerText).join('\\n')"), 'DIALOG:', await run("document.querySelector('.contact-task-dialog')?.innerText ?? ''"), 'SESSIONS:', await run("window.electronAPI.db.getSessionWorkspace().then(w => JSON.stringify(w.sessions.map(s => ({ id: s.id.slice(0, 8), title: s.title, unread: s.unreadCount, active: s.id === w.activeSession?.id }))))"), 'MESSAGES:', await run("document.querySelector('.message-area')?.innerText.slice(0, 400) ?? ''"))
    throw error
  } finally {
    if (comparisonContact) await run(`window.electronAPI.characters.remove(${JSON.stringify(comparisonContact)})`)
    // Chat traffic and routine deliveries live only in the throwaway sessions; deleting
    // them leaves the migrated fixture exactly as the script-level verify expects.
    if (chatSession) await run(`window.electronAPI.db.deleteSession(${JSON.stringify(chatSession)})`)
    if (summarySession) await run(`window.electronAPI.db.deleteSession(${JSON.stringify(summarySession)})`)
    saveConfig(config); window.webContents.send('config:changed', getConfig())
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}
