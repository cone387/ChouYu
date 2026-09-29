import { useState } from 'react'
import type { Message } from '../../shared/types'
import { reminderKey, type AssistantSnooze } from '../../../../shared/reminders'
import { openTaskWorkspace } from '../Tasks/taskNavigation'
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
