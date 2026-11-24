import type { BrowserWindow } from 'electron'
import { appendAssistantMessage, appendAgentNotice, getConfig, getSessions, markSessionRead, saveConfig, getActiveSession, selectChatSession, createChatSession, createCharacter, getCharacter, deleteCharacter, deleteChatSession, flushDatabase, getReminderItems, saveReminderItems, getSession } from '../database'
import { notifyReminderChanges } from '../reminder-events'
import { waitForRenderer } from './storage-smoke'
import { snapshots } from './chat-smoke'
import { FollowupService } from '../reminders/followups'
import { appendReminderFollowup, hasPersistedReminderReceipt, markReminderRead } from '../database'
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
    const task = await window.webContents.executeJavaScript(`window.electronAPI.tasks.create({ title: '晚间总结：记录成果与明日重点', remindAt: ${at} })`)
    appendAssistantMessage('任务提醒：晚间总结：记录成果与明日重点', undefined, 'task', { receiptIds: ['smoke-task'], taskReminder: { taskId: task.id, reminderAt: at } })
    notifyReminderChanges()
    window.webContents.send('open-assistant-chat')
    await waitForRenderer(window, "document.querySelector('[data-assistant-kind=task] .reminder-actions')")
    const click = async (text: string) => {
      const item = getReminderItems().find(item => item.source.kind === 'todo' && item.source.ref.taskId === task.id)
      if (item) await waitForRenderer(window, `document.querySelector('[data-assistant-kind=task] [data-reminder-id="${item.id}"]')?.dataset.reminderRevision === '${item.revision}'`)
      // The changed event updates the receipt before the mutation promise clears
      // busy. Wait for an actionable button, not merely its new status text.
      await waitForRenderer(window, `[...document.querySelectorAll('[data-assistant-kind=task] .reminder-actions button')].some(b => (b.textContent === ${JSON.stringify(text)} || b.getAttribute('aria-label') === ${JSON.stringify(text)}) && !b.disabled)`)
      await window.webContents.executeJavaScript(`(() => { const button = [...document.querySelectorAll('[data-assistant-kind=task] .reminder-actions button')].find(b => b.textContent === ${JSON.stringify(text)} || b.getAttribute('aria-label') === ${JSON.stringify(text)}); if (!button || button.disabled) throw new Error('Reminder action unavailable: ' + ${JSON.stringify(text)}); button.click() })()`)
    }
    await snapshots(window, 'reminder-card-default', '[data-assistant-kind="task"]')
    await click('更多通知操作')
    await click('标记已读')
    await waitForRenderer(window, "document.querySelector('[data-assistant-kind=task] .reminder-followup-state')?.getAttribute('aria-label') === '已读 · 待处理'")
    const tracked = () => getReminderItems().find(item => item.source.kind === 'todo' && item.source.ref.taskId === task.id)!
    if (tracked().status !== 'pending') throw new Error('Reading falsely processed the task')
    await click('更多通知操作'); await click('提醒设置')
    await window.webContents.executeJavaScript(`(() => { const input = document.querySelector('[data-assistant-kind=task] [aria-label="持续提醒间隔（分钟）"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '60'); input.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await click('保存')
    await click('更多通知操作'); await click('提醒设置')
    await waitForRenderer(window, "document.querySelector('[data-assistant-kind=task] .reminder-actions')?.textContent.includes('每 60 分钟提醒')")
    await snapshots(window, 'reminder-card-settings', '[data-assistant-kind="task"]')
    // A real pointer action resets the app's previous Escape restoration guard.
    await window.webContents.executeJavaScript("document.querySelector('.notification-card-popup button').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))")
    await click('取消')
    await waitForRenderer(window, "!document.querySelector('.notification-card-popup') && document.activeElement?.getAttribute('aria-label') === '更多通知操作'")
    await click('更多通知操作'); await click('提醒设置')
    await window.webContents.executeJavaScript("document.querySelector('.notification-card-popup').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))")
    // Escape deliberately clears restored button focus across the application.
    // Wait through both cleanup frames instead of observing transient focus.
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await waitForRenderer(window, "!document.querySelector('.notification-card-popup') && Boolean(document.querySelector('.chat-panel .message-area')) && document.activeElement?.getAttribute('aria-label') !== '更多通知操作'")
    const pendingItem = tracked()
    saveReminderItems([{ ...pendingItem, nextAt: Date.now() - 1, revision: pendingItem.revision + 1 }]); notifyReminderChanges()
    await waitForRenderer(window, "document.querySelectorAll('.notification-card').length >= 2", 25000)
    if (await window.webContents.executeJavaScript("document.querySelector('.message-area')?.textContent.includes('这条提醒还等你处理。')")) throw new Error('Generic followup bubble hides the subject')
    if (getReminderItems().filter(item => item.source.kind === 'todo' && item.source.ref.taskId === task.id).length !== 1) throw new Error('Followup created a second pending item')
    if (!getSession(tracked().sessionId)!.messages.some(message => message.reminderFollowup)) throw new Error('Followup did not persist')
    await click('更多通知操作'); await click('查看原消息')
    await waitForRenderer(window, "Boolean(document.querySelector('[data-assistant-kind=task]'))")
    await window.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(button => button.textContent === '返回完整会话')?.click()")
    await click('稍后提醒'); await click('10 分钟后')
    await waitForRenderer(window, "document.querySelector('.reminder-actions')?.textContent.includes('已稍后提醒')")
    await click('稍后提醒'); await click('30 分钟后')
    await waitForRenderer(window, "!document.querySelector('.notification-card-popup')")
    const pending = await window.webContents.executeJavaScript('window.electronAPI.reminders.list()')
    if (pending.length !== 1 || pending[0].dueAt < Date.now() + 29 * 60_000) throw new Error('Snooze did not replace existing deadline')
    await snapshots(window, 'reminder-actions', '[data-assistant-kind="task"]')
    await window.webContents.reload()
    await waitForRenderer(window, "Boolean(document.querySelector('.pet-container'))")
    await controlledFocus(); window.webContents.send('open-assistant-chat')
    await waitForRenderer(window, "document.querySelector('.reminder-actions')?.textContent.includes('已稍后提醒')")
    await click('更多通知操作'); await click('提醒设置')
    await click('恢复周期')
    await waitForRenderer(window, "!document.querySelector('.reminder-actions')?.textContent.includes('已稍后提醒')")
    await click('稍后提醒'); await click('10 分钟后')
    await waitForRenderer(window, "document.querySelector('.reminder-actions')?.textContent.includes('已稍后提醒')")
    await window.webContents.executeJavaScript(`window.electronAPI.tasks.complete(${JSON.stringify(task.id)})`)
    await window.webContents.executeJavaScript(`new Promise((resolve, reject) => { const until = Date.now() + 20_000; const check = async () => { if (!(await window.electronAPI.reminders.list()).length) return resolve(true); if (Date.now() > until) return reject(new Error('Completed task retained snooze')); setTimeout(check, 100) }; check() })`)
    await waitForRenderer(window, "document.querySelector('[data-assistant-kind=task] .reminder-actions')?.textContent.includes('已处理')", 20000)
    if (tracked().status !== 'processed') throw new Error('Actual task completion did not end followup')
    appendAssistantMessage('晨报已准备好，请查收。', undefined, 'notification', { receiptIds: ['smoke-acknowledge'] }); notifyReminderChanges()
    await waitForRenderer(window, "[...document.querySelectorAll('[data-assistant-kind=notification] button')].some(button => button.textContent === '知道了')")
    await window.webContents.executeJavaScript("[...document.querySelectorAll('[data-assistant-kind=notification] button')].find(button => button.textContent === '知道了').click()")
    await waitForRenderer(window, "document.querySelector('[data-assistant-kind=notification] .reminder-actions')?.textContent.includes('已处理')")
    await snapshots(window, 'reminder-acknowledged', '[data-assistant-kind="notification"]')
    // Each overdue item gets its own persisted message; an earlier read must not mark a new followup read.
    appendAssistantMessage('逐项提醒甲', undefined, 'greeting', { receiptIds: ['smoke-individual-a'] })
    appendAssistantMessage('逐项提醒乙', undefined, 'greeting', { receiptIds: ['smoke-individual-b'] })
    const individual = getReminderItems().filter(item => item.label.startsWith('逐项提醒'))
    if (individual.length !== 2) throw new Error('Missing individual reminder fixtures')
    markReminderRead(individual[0])
    saveReminderItems(individual.map(item => ({ ...item, nextAt: Date.now() - 1 })))
    const service = new FollowupService({ items: () => getReminderItems().filter(item => individual.some(original => original.id === item.id)),
      save: saveReminderItems, source: async () => ({ status: 'pending' }), complete: async () => {}, markRead: markReminderRead,
      isRead: () => false, deliver: appendReminderFollowup, delivered: hasPersistedReminderReceipt, changed: notifyReminderChanges })
    await service.tick(); service.stop()
    const followupMessages = getSession(individual[0].sessionId)!.messages.filter(message => message.reminderFollowup && message.reminderIds?.some(id => individual.some(item => item.id === id)))
    if (followupMessages.length !== 2 || followupMessages.some(message => message.reminderIds?.length !== 1)) throw new Error('Overdue reminders were combined')
    const stateOf = (messageId: string) => `document.querySelector('[data-message-id="${messageId}"] .reminder-followup-state')?.getAttribute('aria-label')`
    await waitForRenderer(window, `${stateOf(individual[0].messageId)}?.includes('已读 · 待处理')`)
    for (const message of followupMessages) await waitForRenderer(window, `${stateOf(message.id)}?.includes('未读 · 待处理')`)
    await snapshots(window, 'reminder-individual-unread', `[data-message-id="${followupMessages[0].id}"]`)
    await window.webContents.executeJavaScript(`document.querySelector('[data-message-id="${followupMessages[0].id}"] [aria-label="更多通知操作"]').click()`)
    await snapshots(window, 'reminder-card-more', `[data-message-id="${followupMessages[0].id}"]`)
    const geometry = await window.webContents.executeJavaScript(`(() => { const popup = document.querySelector('.notification-card-popup'); const box = popup.getBoundingClientRect(); return popup.matches(':popover-open') && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight })()`)
    if (!geometry) throw new Error('Reminder popup is clipped or outside viewport')
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('[data-message-id="${followupMessages[0].id}"] button')].find(button => button.textContent === '标记已读').click()`)
    await waitForRenderer(window, `${stateOf(followupMessages[0].id)}?.includes('已读 · 待处理')`)
    await waitForRenderer(window, `${stateOf(followupMessages[1].id)}?.includes('未读 · 待处理')`)
    await window.webContents.reload()
    await waitForRenderer(window, "Boolean(document.querySelector('.pet-container'))")
    await controlledFocus(); window.webContents.send('open-assistant-chat')
    await waitForRenderer(window, `${stateOf(followupMessages[0].id)}?.includes('已读 · 待处理')`)
    await waitForRenderer(window, `${stateOf(followupMessages[1].id)}?.includes('未读 · 待处理')`)
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
    await waitForRenderer(window, `${stateOf(followupMessages[1].id)}?.includes('已读 · 待处理')`)
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
