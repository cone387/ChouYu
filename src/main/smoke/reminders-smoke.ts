import type { BrowserWindow } from 'electron'
import { appendAssistantMessage, appendAgentNotice, getConfig, getSessions, markSessionRead, saveConfig, getActiveSession, selectChatSession, createChatSession, createCharacter, getCharacter, deleteCharacter, deleteChatSession, flushDatabase, getReminderItems, saveReminderItems, getSession } from '../database'
import { notifyReminderChanges } from '../reminder-events'
import { waitForRenderer } from './storage-smoke'
import { snapshots } from './chat-smoke'
/** Isolated desktop UI/data test. Focus is controlled explicitly because the test window is hidden. */
export async function runRemindersSmoke(window: BrowserWindow): Promise<void> {
  const original = getConfig(), originalSession = getActiveSession().id
  const existing = new Set(getSessions().map(s => s.id))
  // Proactive deliveries now share ChouYu's chat; isolate them from migration fixtures.
  createChatSession('提醒验收会话')
  const contact = createCharacter({ name: '提醒验收联系人', avatar: '', soulMd: '', category: '', model: 'test-model' })
  // UI-only configured fixture; no model request is made by these reminder actions.
  saveConfig({ baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'smoke-key', proactiveGreeting: false, proactiveRestReminder: false, proactiveReturn: false })
  window.webContents.send('config:changed', getConfig())
  for (const session of getSessions()) markSessionRead(session.id)
  const controlledFocus = () => window.webContents.executeJavaScript(`Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => window.__reminderFocused === true }); window.__reminderFocused = false;`)
  try {
    await controlledFocus()
    const at = Date.now() + 3600_000
    const task = await window.webContents.executeJavaScript(`window.electronAPI.tasks.create({ title: '提醒来源验证', remindAt: ${at} })`)
    appendAssistantMessage('任务提醒：提醒来源验证', undefined, 'task', { receiptIds: ['smoke-task'], taskReminder: { taskId: task.id, reminderAt: at } })
    notifyReminderChanges()
    window.webContents.send('open-assistant-chat')
    await waitForRenderer(window, "document.querySelector('[data-assistant-kind=task] .reminder-actions')")
    const click = async (text: string) => {
      const item = getReminderItems().find(item => item.source.kind === 'todo' && item.source.ref.taskId === task.id)
      if (item) await waitForRenderer(window, `document.querySelector('[data-assistant-kind=task] [data-reminder-id="${item.id}"]')?.dataset.reminderRevision === '${item.revision}'`)
      // The changed event updates the receipt before the mutation promise clears
      // busy. Wait for an actionable button, not merely its new status text.
      await waitForRenderer(window, `[...document.querySelectorAll('[data-assistant-kind=task] .reminder-actions button')].some(b => b.textContent === ${JSON.stringify(text)} && !b.disabled)`)
      await window.webContents.executeJavaScript(`(() => { const button = [...document.querySelectorAll('[data-assistant-kind=task] .reminder-actions button')].find(b => b.textContent === ${JSON.stringify(text)}); if (!button || button.disabled) throw new Error('Reminder action unavailable: ' + ${JSON.stringify(text)}); button.click() })()`)
    }
    await click('标记已读')
    await waitForRenderer(window, "document.querySelector('[data-assistant-kind=task] .reminder-actions')?.textContent.includes('已读 · 待处理')")
    const tracked = () => getReminderItems().find(item => item.source.kind === 'todo' && item.source.ref.taskId === task.id)!
    if (tracked().status !== 'pending') throw new Error('Reading falsely processed the task')
    await window.webContents.executeJavaScript(`document.querySelector('[data-assistant-kind=task] .reminder-actions summary').click()`)
    await window.webContents.executeJavaScript(`(() => { const input = document.querySelector('[data-assistant-kind=task] [aria-label="持续提醒间隔（分钟）"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '60'); input.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await click('应用')
    await waitForRenderer(window, "document.querySelector('[data-assistant-kind=task] .reminder-actions')?.textContent.includes('每 60 分钟提醒')")
    const pendingItem = tracked()
    saveReminderItems([{ ...pendingItem, nextAt: Date.now() - 1, revision: pendingItem.revision + 1 }]); notifyReminderChanges()
    await waitForRenderer(window, "document.querySelector('.message-area')?.textContent.includes('这条提醒还等你处理。')", 25000)
    if (getReminderItems().filter(item => item.source.kind === 'todo' && item.source.ref.taskId === task.id).length !== 1) throw new Error('Followup created a second pending item')
    if (!getSession(tracked().sessionId)!.messages.some(message => message.reminderFollowup)) throw new Error('Followup did not persist')
    await window.webContents.executeJavaScript("[...document.querySelectorAll('.reminder-actions button')].find(button => button.textContent === '查看原消息').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('[data-assistant-kind=task]'))")
    await window.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(button => button.textContent === '返回完整会话')?.click()")
    await click('稍后提醒')
    await waitForRenderer(window, "document.querySelector('.reminder-actions')?.textContent.includes('已安排')")
    await window.webContents.executeJavaScript(`(() => { const select = document.querySelector('[aria-label="稍后提醒间隔"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, '30'); select.dispatchEvent(new Event('change', { bubbles: true })) })()`)
    await click('调整提醒')
    await waitForRenderer(window, "[...document.querySelectorAll('.reminder-actions button')].some(b => b.textContent === '调整提醒' && !b.disabled)")
    const pending = await window.webContents.executeJavaScript('window.electronAPI.reminders.list()')
    if (pending.length !== 1 || pending[0].dueAt < Date.now() + 29 * 60_000) throw new Error('Snooze did not replace existing deadline')
    await snapshots(window, 'reminder-actions', '[data-assistant-kind="task"]')
    await window.webContents.reload()
    await waitForRenderer(window, "Boolean(document.querySelector('.pet-container'))")
    await controlledFocus(); window.webContents.send('open-assistant-chat')
    await waitForRenderer(window, "document.querySelector('.reminder-actions')?.textContent.includes('已安排')")
    await click('恢复周期')
    await waitForRenderer(window, "!document.querySelector('.reminder-actions')?.textContent.includes('已安排')")
    await click('稍后提醒')
    await waitForRenderer(window, "document.querySelector('.reminder-actions')?.textContent.includes('已安排')")
    await window.webContents.executeJavaScript(`window.electronAPI.tasks.complete(${JSON.stringify(task.id)})`)
    await window.webContents.executeJavaScript(`new Promise((resolve, reject) => { const until = Date.now() + 20_000; const check = async () => { if (!(await window.electronAPI.reminders.list()).length) return resolve(true); if (Date.now() > until) return reject(new Error('Completed task retained snooze')); setTimeout(check, 100) }; check() })`)
    await waitForRenderer(window, "document.querySelector('[data-assistant-kind=task] .reminder-actions')?.textContent.includes('已处理')", 20000)
    if (tracked().status !== 'processed') throw new Error('Actual task completion did not end followup')
    appendAssistantMessage('晨报已准备好，请查收。', undefined, 'notification', { receiptIds: ['smoke-acknowledge'] }); notifyReminderChanges()
    await waitForRenderer(window, "[...document.querySelectorAll('[data-assistant-kind=notification] button')].some(button => button.textContent === '知道了／已阅')")
    await window.webContents.executeJavaScript("[...document.querySelectorAll('[data-assistant-kind=notification] button')].find(button => button.textContent === '知道了／已阅').click()")
    await waitForRenderer(window, "document.querySelector('[data-assistant-kind=notification] .reminder-actions')?.textContent.includes('已处理')")
    await snapshots(window, 'reminder-acknowledged', '[data-assistant-kind="notification"]')
    // Backgound and scrolled-up conversations must keep unread, all the way to the pet/tray count.
    for (let i = 0; i < 15; i++) appendAssistantMessage(`休息提醒 ${i}：看看远处，喝口水。`, undefined, 'rest')
    notifyReminderChanges()
    await waitForRenderer(window, "document.querySelectorAll('[data-assistant-kind=rest]').length >= 15")
    const unread = await window.webContents.executeJavaScript('window.electronAPI.getAssistantUnread()')
    if (!unread) throw new Error('Background conversation consumed unread')
    // Model an actual user scroll; assigning scrollTop alone does not detach
    // the streaming follow mode from subsequent ResizeObserver measurements.
    await window.webContents.executeJavaScript("(() => { const area = document.querySelector('.message-area'); area.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true })); area.scrollTop = 0; area.dispatchEvent(new Event('scroll')); window.__reminderFocused = true; window.dispatchEvent(new Event('focus')) })()")
    await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 800))')
    if (await window.webContents.executeJavaScript("document.querySelector('.message-area').scrollTop") !== 0) throw new Error('Scrolled-up viewport did not retain its reading position')
    if (await window.webContents.executeJavaScript('window.electronAPI.getAssistantUnread()') !== unread) throw new Error('Scrolled-up conversation consumed unread')
    await window.webContents.executeJavaScript("const area = document.querySelector('.message-area'); area.scrollTop = area.scrollHeight; area.dispatchEvent(new Event('scroll'))")
    await waitForRenderer(window, "!document.querySelector('.conversation-item-unread')", 8000)
    if (await window.webContents.executeJavaScript('window.electronAPI.getAssistantUnread()') !== 0) throw new Error('Visible latest messages did not clear unread')
    await window.webContents.executeJavaScript('window.__reminderFocused = false')
    appendAgentNotice({ id: 'reminder-smoke', characterId: contact.id, topicId: 'smoke-topic', runId: 'smoke-run', kind: 'progress', topicRevision: 1, content: '联系人也有未读进展', createdAt: Date.now() })
    notifyReminderChanges()
    if (await window.webContents.executeJavaScript('window.electronAPI.getAssistantUnread()') !== 1) throw new Error('Contact notice missing from global unread')
    window.webContents.send('open-assistant-chat')
    await waitForRenderer(window, "document.querySelector('.message-area')?.textContent.includes('联系人也有未读进展')")
    await window.webContents.executeJavaScript("window.__unreadAfterDeletion = -1; window.__unreadCleanup = window.electronAPI.onAssistantUnread(n => window.__unreadAfterDeletion = n); void 0")
    await window.webContents.executeJavaScript(`window.electronAPI.characters.remove(${JSON.stringify(contact.id)})`)
    await waitForRenderer(window, 'window.__unreadAfterDeletion === 0')
    console.log('CHOUYU_REMINDERS_SMOKE_PASSED persistent followup, independent read/processed, interval edit, postponement/resume, renderer restart, actual task completion, explicit acceptance, source navigation, unified unread')
  } finally {
    await window.webContents.executeJavaScript('delete document.hasFocus; delete window.__reminderFocused; window.__unreadCleanup?.(); delete window.__unreadCleanup; delete window.__unreadAfterDeletion').catch(() => {})
    await window.webContents.executeJavaScript("document.querySelector('[aria-label=\"关闭面板\"]')?.click()").catch(() => {})
    if (getCharacter(contact.id)) deleteCharacter(contact.id)
    for (const session of getSessions()) if (!existing.has(session.id)) deleteChatSession(session.id)
    selectChatSession(originalSession); flushDatabase()
    saveConfig(original); window.webContents.send('config:changed', getConfig())
  }
}
