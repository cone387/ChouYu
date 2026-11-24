// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import FollowupActions from './FollowupActions'
import { TrackedReminderActions } from './ReminderActions'
import type { ReminderView } from '../../../../shared/reminder-followups'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const item: ReminderView = { id: 'a', owner: 'chouyu', sessionId: 's', messageId: 'm', label: '晚间总结：记录成果与明日重点', source: { kind: 'message' },
  acknowledgement: 'received', status: 'pending', intervalMinutes: 30, nextAt: 2000, createdAt: 1000, revision: 1, read: false }
let root: Root | undefined
const updated = vi.fn()
async function render(node: React.ReactNode) {
  if (!root) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host) }
  await act(async () => root!.render(node))
}
async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find(button => button.textContent === label || button.getAttribute('aria-label') === label)
  expect(button, label).toBeTruthy()
  await act(async () => button!.click())
}
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ''; vi.restoreAllMocks(); updated.mockReset() })
it('shows content, per-message reading and only primary actions until more is opened', async () => {
  await render(<FollowupActions item={item} />)
  expect(document.querySelector('.notification-card')?.textContent).toContain(item.label)
  expect(document.querySelector('.notification-card')?.textContent).toContain('未读')
  expect([...document.querySelectorAll('button')].map(button => button.textContent)).toEqual(['⋯', '知道了', '稍后提醒'])
  expect(document.body.textContent).not.toContain('每 30 分钟')
  await click('更多通知操作')
  expect(document.body.textContent).toContain('查看原消息')
  expect(document.body.textContent).toContain('标记已读')
  await click('提醒设置')
  expect(document.body.textContent).toContain('每 30 分钟提醒')
  expect(document.querySelector('input')?.value).toBe('30')
})
it('keeps settings and input on failure and closes them only after a saved action', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('保存失败')).mockResolvedValue({ ...item, intervalMinutes: 60, revision: 2 })
  Object.assign(window, { electronAPI: { reminders: { act: save } } })
  await render(<FollowupActions item={item} onUpdated={updated} />)
  await click('更多通知操作'); await click('提醒设置')
  const input = document.querySelector('input')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '60'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  await click('保存')
  expect(document.querySelector('input')?.value).toBe('60')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('保存失败')
  expect(updated).not.toHaveBeenCalled()
  await click('保存')
  expect(save).toHaveBeenLastCalledWith('a', 1, 'interval', 60)
  expect(updated).toHaveBeenCalledWith(expect.objectContaining({ intervalMinutes: 60 }))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
it('chooses a postponement without processing, and Escape only closes the popup', async () => {
  const save = vi.fn().mockResolvedValue({ ...item, postponed: true, revision: 2 })
  Object.assign(window, { electronAPI: { reminders: { act: save } } })
  await render(<FollowupActions item={item} onUpdated={updated} />)
  await click('稍后提醒'); await click('30 分钟后')
  expect(save).toHaveBeenCalledWith('a', 1, 'postpone', 30)
  await click('更多通知操作')
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  await act(async () => document.querySelector('[role="dialog"]')!.dispatchEvent(escape))
  expect(escape.defaultPrevented).toBe(true)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement?.getAttribute('aria-label')).toBe('更多通知操作')
})
it('preserves original content but replaces a followup generic bubble with its source title', async () => {
  const message = { id: 'followup', role: 'assistant' as const, content: '这条提醒还等你处理。', timestamp: 3000, reminderIds: ['a'], reminderFollowup: true }
  await render(<TrackedReminderActions message={message} items={[{ ...item, read: true }]} onUpdated={updated}><p>这条提醒还等你处理。</p></TrackedReminderActions>)
  expect(document.body.textContent).not.toContain('这条提醒还等你处理。')
  expect(document.body.textContent).toContain(item.label)
  expect(document.querySelector('.notification-card')?.textContent).toContain('未读')
  await render(<TrackedReminderActions message={{ ...message, reminderFollowup: false, reminderReadIds: ['a'] }} items={[{ ...item, status: 'processed' }]} onUpdated={updated}><p>第一段正文</p><p>最后一段正文</p></TrackedReminderActions>)
  expect(document.querySelector('.notification-card')?.textContent).toContain('最后一段正文')
  expect(document.body.textContent).toContain('已读')
  expect(document.body.textContent).toContain('已处理')
  expect(document.body.textContent).not.toContain('稍后提醒')
})
it('requires real task action, keeps errors visible, and removes popups when hidden', async () => {
  await render(<FollowupActions item={{ ...item, acknowledgement: 'task', source: { kind: 'todo', ref: { taskId: 't', reminderAt: 1000 } }, error: '来源读取失败' }} />)
  expect(document.body.textContent).toContain('完成任务')
  expect(document.body.textContent).not.toContain('知道了')
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('来源读取失败')
  await click('更多通知操作')
  await render(<FollowupActions item={item} active={false} />)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
it('dismisses the old popup when keyboard focus moves to another card', async () => {
  await render(<><FollowupActions item={item} /><FollowupActions item={{ ...item, id: 'b', label: '第二项' }} /></>)
  const buttons = document.querySelectorAll<HTMLButtonElement>('[aria-label="更多通知操作"]')
  await act(async () => buttons[0].click())
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
  await act(async () => buttons[1].focus())
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0)
  await act(async () => buttons[1].click())
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0)
  expect(document.activeElement).toBe(buttons[1])
})
