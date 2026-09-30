import type { BrowserWindow } from 'electron'
import { createServer } from 'node:http'
import { getConfig, saveConfig, getState, setState } from '../database'
import { waitForRenderer } from './storage-smoke'
import { snapshots } from './chat-smoke'

/** Real UI/IPC/storage with a local model fixture; never calls a paid model. */
export async function runAssistantRoutinesSmoke(window: BrowserWindow) {
  const config = getConfig()
  const run = (script: string) => window.webContents.executeJavaScript(script)
  const initialSession = await run('window.electronAPI.db.getSessionWorkspace().then(workspace => workspace.activeSession)')
  let fail = false
  let comparisonContact = ''
  let summarySession = ''
  const server = createServer((request, response) => {
    if (request.method === 'GET') { response.end(JSON.stringify({ data: [{ id: 'smoke-natural' }] })); return }
    let body = ''
    request.on('data', chunk => { body += chunk.toString() })
    request.on('end', () => {
      const payload = JSON.parse(body)
      const context = JSON.parse(payload.messages.at(-1).content)
      const result = context.evidence ? '对照联系人的任务已建立，目前尚未执行。' : fail ? 'invalid-json' : JSON.stringify(context.description.includes('补充') || context.existing
        ? { kind: 'routine', input: { title: '联系人晨间总结', instruction: '汇总联系人进展和待答复事项', time: context.existing ? '09:00' : '08:30', cadence: 'weekdays', kind: 'contact-summary', enabled: context.existing?.enabled ?? true } }
        : { kind: 'question', question: '每个工作日早上几点汇报？' })
      response.setHeader('Content-Type', 'text/event-stream')
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: result } }] })}\n\ndata: [DONE]\n\n`)
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

  try {
    window.webContents.send('open-assistant-chat')
    await waitForRenderer(window, "Boolean(document.querySelector('[data-contact-work-tab=work]'))")
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
    if (item.time !== '08:30' || item.cadence !== 'weekdays') throw new Error('Natural schedule not persisted')
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
    if (!await run("document.querySelector('.contact-work-sheet [data-topic-run]').textContent.includes('启用定时')")) throw new Error('Paused schedule implies immediate execution')
    await openEditor('.contact-work-sheet')
    await fill('改成九点')
    await submit()
    await waitForRenderer(window, "!document.querySelector('.contact-task-dialog') && document.querySelector('.contact-work-sheet .topic-detail-pane')?.textContent.includes('09:00')")
    const updated = await run('window.electronAPI.assistantRoutines.list()')
    if (updated.length !== 1 || updated[0].id !== item.id || updated[0].enabled) throw new Error('Edit duplicated task or changed pause state')
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
    if ((await run('window.electronAPI.assistantRoutines.list()')).length) throw new Error('Shared delete dialog did not remove schedule')
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

    // Execute a real scheduled summary, then follow its durable history/chat/task links.
    summarySession = (await run("window.electronAPI.db.createSession('Routine smoke delivery', 'chouyu')")).activeSession.id
    await run("document.querySelector('.contact-work-sheet[open] [aria-label=\"关闭联系人工作弹窗\"]').click()")
    const [executed] = await run("window.electronAPI.assistantRoutines.save({title:'晨报跳转验收',instruction:'汇总联系人进展',time:'08:30',cadence:'daily',kind:'contact-summary',enabled:true})")
    const schedules = JSON.parse(getState('assistant-routines-v1')!)
    schedules.find((entry: {id: string}) => entry.id === executed.id).nextAt = Date.now() - 1000
    setState('assistant-routines-v1', JSON.stringify(schedules))
    await waitForRenderer(window, `window.electronAPI.assistantRoutines.history(${JSON.stringify(executed.id)}).then(page => page.items.some(entry => entry.status === 'completed' && entry.messageId && entry.sessionId))`, 35000)
    window.webContents.send('open-assistant-chat')
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
    await run("document.querySelector('.message-area a[href^=\"#contact-task?\"]').click()")
    await waitForRenderer(window, `Boolean(document.querySelector('.contact-work-sheet[open] [data-topic-current="${topicId}"]'))`)
    if (!await run("document.querySelector('.contact-work-sheet[open]')?.textContent.includes('UI 对照联系人')")) throw new Error('Morning summary opened the wrong contact')
    await snapshots(window, 'morning-summary-task-link', '.contact-work-sheet[open]')
    await run("document.querySelector('.contact-work-sheet[open] [data-contact-dialog-tab=settings]').click()")
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet[open] [data-agent-chat]')?.getClientRects().length > 0")
    await run("document.querySelector('.contact-work-sheet[open] [data-agent-chat]').click()")
    await waitForRenderer(window, `Boolean(document.querySelector('[data-character-bar="${contact.id}"]')) && !document.querySelector('.contact-work-sheet[open]')`)
    window.webContents.send('open-assistant-chat')
    await waitForRenderer(window, "Boolean(document.querySelector('[data-character-bar=chouyu]')) && Boolean(document.querySelector('.message-area a[href^=\"#contact-task?\"]'))")

    await run(`window.electronAPI.characters.remove(${JSON.stringify(comparisonContact)})`)
    comparisonContact = ''
    await run("document.querySelector('.message-area a[href^=\"#contact-task?\"]').click()")
    await waitForRenderer(window, "[...document.querySelectorAll('[role=alert]')].some(el => el.textContent.includes('已删除'))")
    if (await run("Boolean(document.querySelector('.contact-work-sheet[open]'))")) throw new Error('Deleted task link opened a different task')

    console.log('CHOUYU_ASSISTANT_ROUTINES_SMOKE_PASSED shared UI/single input/clarification context/save/pause/edit/settings/delete/no focus decoration/real scheduled delivery/durable history/message navigation/cross-contact task and chat/deleted link feedback')
  } catch (error) {
    console.log('ROUTINE_UI_FAILURE', await run("[...document.querySelectorAll('.contact-work-sheet[open]')].map(el=>el.innerText).join('\\n')"))
    throw error
  } finally {
    if (comparisonContact) await run(`window.electronAPI.characters.remove(${JSON.stringify(comparisonContact)})`)
    // Keep generated notifications isolated from the outer migration fixture.
    if (summarySession) await run(`window.electronAPI.db.deleteSession(${JSON.stringify(summarySession)})`)
    await run(`window.electronAPI.db.selectSession(${JSON.stringify(initialSession.id)})`)
    saveConfig(config); window.webContents.send('config:changed', getConfig())
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}
