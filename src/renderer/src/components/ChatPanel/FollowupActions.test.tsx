import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import FollowupActions from './FollowupActions'
import { TrackedReminderActions } from './ReminderActions'
import type { ReminderView } from '../../../../shared/reminder-followups'
const item: ReminderView = { id: 'a', owner: 'chouyu', sessionId: 's', messageId: 'm', label: '早上好', source: { kind: 'message' },
  acknowledgement: 'received', status: 'pending', intervalMinutes: 30, nextAt: 2000, createdAt: 1000, revision: 1, read: false }
it('separates reading from explicit acceptance and keeps settings out of the default card', () => {
  const html = renderToStaticMarkup(<FollowupActions item={item} />)
  expect(html).toContain('更多通知操作'); expect(html).toContain('知道了'); expect(html).not.toContain('每 30 分钟提醒')
  const read = renderToStaticMarkup(<FollowupActions item={{ ...item, read: true }} />)
  expect(read).toContain('已读 · 待处理'); expect(read).toContain('知道了'); expect(read).not.toContain('>标记已读<')
})
it('requires a real task or interaction action and exposes lookup failures', () => {
  const todo = renderToStaticMarkup(<FollowupActions item={{ ...item, acknowledgement: 'task', source: { kind: 'todo', ref: { taskId: 't', reminderAt: 1000 } } }} />)
  expect(todo).toContain('完成任务'); expect(todo).not.toContain('知道了／已阅')
  const question = renderToStaticMarkup(<FollowupActions item={{ ...item, acknowledgement: 'action', source: { kind: 'interaction', interactionId: 'q' }, error: '读取失败' }} />)
  expect(question).toContain('去处理'); expect(question).toContain('读取失败'); expect(question).not.toContain('知道了／已阅')
})
it('retains source navigation for processed reminders without further schedule controls', () => {
  const html = renderToStaticMarkup(<FollowupActions item={{ ...item, status: 'processed', reason: '已明确接收' }} showSource />)
  expect(html).toContain('已处理'); expect(html).toContain('更多通知操作'); expect(html).not.toContain('稍后提醒间隔')
})
it('shows each message read receipt independently from the original reminder and its processing state', () => {
  const message = { id: 'followup', role: 'assistant' as const, content: 'reminder', timestamp: 3000, reminderIds: ['a'], reminderFollowup: true }
  const unread = renderToStaticMarkup(<TrackedReminderActions message={message} items={[{ ...item, read: true }]} onUpdated={() => {}} />)
  expect(unread).toContain('未读 · 待处理')
  expect(unread).toContain('更多通知操作')
  const read = renderToStaticMarkup(<TrackedReminderActions message={{ ...message, reminderReadIds: ['a'] }} items={[{ ...item, status: 'processed' }]} onUpdated={() => {}} />)
  expect(read).toContain('已读 · 已处理')
})
