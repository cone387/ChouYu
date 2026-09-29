import type { BrowserWindow } from 'electron'
import { appendAssistantMessage, appendAgentNotice, getConfig, getSessions, markSessionRead, saveConfig, getActiveSession, selectChatSession, createCharacter, getCharacter, deleteCharacter, deleteChatSession, flushDatabase } from '../database'
import { notifyReminderChanges } from '../reminder-events'
import { waitForRenderer } from './storage-smoke'
import { snapshots } from './chat-smoke'
/** Isolated desktop UI/data test. Focus is controlled explicitly because the test window is hidden. */
export async function runRemindersSmoke(window: BrowserWindow): Promise<void> {
  const original = getConfig(), originalSession = getActiveSession().id
  const existing = new Set(getSessions().map(s => s.id))
  const contact = createCharacter({ name: '提醒验收联系人', avatar: '', soulMd: '', category: '', model: 'test-model' })
  saveConfig({ proactiveGreeting: false, proactiveRestReminder: false, proactiveReturn: false })
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
    const click = (text: string) => window.webContents.executeJavaScript(`(() => { const button = [...document.querySelectorAll('[data-assistant-kind=task] .reminder-actions button')].find(b => b.textContent === ${JSON.stringify(text)}); if (!button || button.disabled) throw new Error('missing reminder action'); button.click() })()`)
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
    await click('取消提醒')
    await waitForRenderer(window, "!document.querySelector('.reminder-actions')?.textContent.includes('已安排')")
    await click('稍后提醒')
    await waitForRenderer(window, "document.querySelector('.reminder-actions')?.textContent.includes('已安排')")
    await window.webContents.executeJavaScript(`window.electronAPI.tasks.complete(${JSON.stringify(task.id)})`)
    await window.webContents.executeJavaScript(`new Promise((resolve, reject) => { const until = Date.now() + 20_000; const check = async () => { if (!(await window.electronAPI.reminders.list()).length) return resolve(true); if (Date.now() > until) return reject(new Error('Completed task retained snooze')); setTimeout(check, 100) }; check() })`)
    await click('稍后提醒')
    await waitForRenderer(window, "document.querySelector('.reminder-actions [role=alert]')?.textContent.includes('无需再次提醒')")
    // Backgound and scrolled-up conversations must keep unread, all the way to the pet/tray count.
    for (let i = 0; i < 15; i++) appendAssistantMessage(`休息提醒 ${i}：看看远处，喝口水。`, undefined, 'rest')
    notifyReminderChanges()
    await waitForRenderer(window, "document.querySelectorAll('[data-assistant-kind=rest]').length >= 15")
    const unread = await window.webContents.executeJavaScript('window.electronAPI.getAssistantUnread()')
    if (!unread) throw new Error('Background conversation consumed unread')
    await window.webContents.executeJavaScript("document.querySelector('.message-area').scrollTop = 0; window.__reminderFocused = true; window.dispatchEvent(new Event('focus'))")
    await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 800))')
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
    console.log('CHOUYU_REMINDERS_SMOKE_PASSED durable snooze, adjustment/cancel, renderer restart, task invalidation, focused visible reads, unified contact unread navigation')
  } finally {
    await window.webContents.executeJavaScript('delete document.hasFocus; delete window.__reminderFocused; window.__unreadCleanup?.(); delete window.__unreadCleanup; delete window.__unreadAfterDeletion').catch(() => {})
    await window.webContents.executeJavaScript("document.querySelector('[aria-label=\"关闭面板\"]')?.click()").catch(() => {})
    if (getCharacter(contact.id)) deleteCharacter(contact.id)
    for (const session of getSessions()) if (!existing.has(session.id)) deleteChatSession(session.id)
    selectChatSession(originalSession); flushDatabase()
    saveConfig(original); window.webContents.send('config:changed', getConfig())
  }
}
