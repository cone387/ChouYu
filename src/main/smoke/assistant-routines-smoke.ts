import type { BrowserWindow } from 'electron'
import { createServer } from 'node:http'
import { getConfig, saveConfig } from '../database'
import { waitForRenderer } from './storage-smoke'
import { snapshots } from './chat-smoke'

/** Real UI/IPC/storage with a local model fixture; never calls a paid model. */
export async function runAssistantRoutinesSmoke(window: BrowserWindow) {
  const config = getConfig()
  const run = (script: string) => window.webContents.executeJavaScript(script)
  let fail = false
  const server = createServer((request, response) => {
    if (request.method === 'GET') { response.end(JSON.stringify({ data: [{ id: 'smoke-natural' }] })); return }
    let body = ''
    request.on('data', chunk => { body += chunk.toString() })
    request.on('end', () => {
      const payload = JSON.parse(body)
      const context = JSON.parse(payload.messages.at(-1).content)
      const result = fail ? 'invalid-json' : JSON.stringify(context.description.includes('补充') || context.existing
        ? { kind: 'routine', input: { title: '联系人晨间总结', instruction: '汇总联系人进展和待答复事项', time: context.existing ? '09:00' : '08:30', cadence: 'weekdays', kind: 'contact-summary', enabled: context.existing?.enabled ?? true } }
        : { kind: 'question', question: '每个工作日早上几点汇报？' })
      response.setHeader('Content-Type', 'text/event-stream')
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: result } }] })}\n\ndata: [DONE]\n\n`)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  saveConfig({ provider: 'openai', baseUrl: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/v1`, apiKey: 'smoke-key', model: 'smoke-natural', proactiveGreeting: false, proactiveRestReminder: false, proactiveReturn: false })
  window.webContents.send('config:changed', getConfig())
  const fill = (value: string) => run(`(() => { const input = document.querySelector('[data-task-description]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  const submit = () => run("document.querySelector('[data-task-dialog-submit]').click()")
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
    await fill('八点半')
    await submit()
    await waitForRenderer(window, "!document.querySelector('.contact-task-dialog') && document.querySelector('.contact-work-sheet .topic-detail-pane')?.textContent.includes('08:30')", 20000)
    const [item] = await run('window.electronAPI.assistantRoutines.list()')
    if (item.time !== '08:30' || item.cadence !== 'weekdays') throw new Error('Natural schedule not persisted')
    await snapshots(window, 'assistant-natural-saved', '.contact-work-sheet .topic-detail-pane')
    await run("[...document.querySelectorAll('.contact-work-sheet .topic-detail-pane button')].find(b => b.textContent === '暂停').click()")
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet .topic-detail-pane')?.textContent.includes('已暂停')")
    await run("[...document.querySelectorAll('.contact-work-sheet .topic-detail-pane button')].find(b => b.textContent === '修改任务').click()")
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
    await run("[...document.querySelectorAll('#settings-assistant-routines .topic-detail-pane button')].find(b => b.textContent === '修改任务').click()")
    await run("document.querySelector('.contact-task-dialog').requestClose()")
    await waitForRenderer(window, "!document.querySelector('.contact-task-dialog')")
    await run(`window.electronAPI.assistantRoutines.remove(${JSON.stringify(updated[0].id)}, ${updated[0].revision})`)
    console.log('CHOUYU_ASSISTANT_ROUTINES_SMOKE_PASSED unified list/single input/model clarification/failure preserves draft/save/pause/natural edit/settings sync/cancel/no focus decoration')
  } finally {
    saveConfig(config); window.webContents.send('config:changed', getConfig())
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}
