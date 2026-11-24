import { useState, type ReactNode } from 'react'
import type { Message } from '../../shared/types'
import { reminderKey, type AssistantSnooze } from '../../../../shared/reminders'
import { openTaskWorkspace } from '../Tasks/taskNavigation'
import FollowupActions from './FollowupActions'
import type { ReminderView } from '../../../../shared/reminder-followups'
export function TrackedReminderActions({ message, items, error, active = true, children, onUpdated }: { message: Message; items: ReminderView[]; error?: string; active?: boolean; children?: ReactNode; onUpdated(item: ReminderView): void }) {
  if (!message.reminderIds?.length) return <>{children}</>
  const multiple = message.reminderIds.length > 1
  const label = message.communication?.intent === 'delivery' ? '成果通知' : message.assistantKind === 'rest' ? '休息提醒'
    : message.assistantKind === 'greeting' ? '日常问候' : message.assistantKind === 'return' ? '回来提醒' : '通知提醒'
  return <>{multiple && !message.reminderFollowup && children}{message.reminderIds.map(id => {
    const item = items.find(item => item.id === id)
    return item ? <FollowupActions key={id} item={{ ...item, read: message.reminderReadIds?.includes(id) ?? false }} label={label} active={active} onUpdated={onUpdated}>
      {!message.reminderFollowup && !multiple ? message.taskReminder && !message.content.includes('\n')
        ? <h3 className="reminder-followup-title">{message.content.replace(/^任务提醒：/, '')}</h3> : children : undefined}
    </FollowupActions>
      : <div key={id} className="notification-card">{!multiple && children}<div role={error ? 'alert' : 'status'}>{error || '正在读取提醒状态…'}</div></div>
  })}</>
}
export default function ReminderActions({ sessionId, message, pending, canPostpone }: { sessionId: string; message: Message; pending: AssistantSnooze[]; canPostpone: boolean }) {
  const [minutes, setMinutes] = useState(10)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const key = reminderKey(sessionId, message), scheduled = pending.find(item => item.key === key)
  const act = async (cancel: boolean) => {
    setBusy(true); setError('')
    try {
      if (cancel) await window.electronAPI.reminders.cancel(key)
      else await window.electronAPI.reminders.schedule(sessionId, message.id, minutes)
    } catch (e) { setError(e instanceof Error ? e.message : '提醒保存失败，请重试。') }
    finally { setBusy(false) }
  }
  return <div className="reminder-actions" role="group" aria-label="提醒操作">
    {(message.taskReminder || message.assistantKind === 'task-backlog') && <button type="button" onClick={() => openTaskWorkspace({ taskId: message.taskReminder?.taskId })}>查看任务</button>}
    {canPostpone && <><select aria-label="稍后提醒间隔" value={minutes} disabled={busy} onChange={e => setMinutes(Number(e.target.value))}>
      <option value={10}>10 分钟后</option><option value={30}>30 分钟后</option><option value={60}>1 小时后</option>
    </select><button type="button" disabled={busy} onClick={() => void act(false)}>{scheduled ? '调整提醒' : '稍后提醒'}</button></>}
    {scheduled && <><span role="status">已安排 {new Date(scheduled.dueAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 提醒</span><button type="button" disabled={busy} onClick={() => void act(true)}>取消提醒</button></>}
    {error && <span role="alert">{error}</span>}
  </div>
}
