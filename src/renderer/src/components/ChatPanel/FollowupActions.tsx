import { useEffect, useState } from 'react'
import type { ReminderAction, ReminderView } from '../../../../shared/reminder-followups'
import { navigateContact } from '../Contacts/contactNavigation'
import { openTaskWorkspace } from '../Tasks/taskNavigation'

export default function FollowupActions({ item, showSource = false, onUpdated }: { item: ReminderView; showSource?: boolean; onUpdated?: (item: ReminderView) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [delay, setDelay] = useState(10), [interval, setInterval] = useState(String(item.intervalMinutes))
  useEffect(() => setInterval(String(item.intervalMinutes)), [item.intervalMinutes])
  const act = async (action: ReminderAction, minutes?: number) => {
    setBusy(true); setError('')
    try { onUpdated?.(await window.electronAPI.reminders.act(item.id, item.revision, action, minutes)) }
    catch (error) { setError(error instanceof Error ? error.message : '提醒操作未保存，请重试。') }
    finally { setBusy(false) }
  }
  const navigate = async (original = false) => {
    setError('')
    try {
      if (original || item.source.kind === 'message') await navigateContact({ kind: 'message', sessionId: item.sessionId, messageId: item.messageId })
      else if (item.source.kind === 'todo') openTaskWorkspace({ taskId: item.source.ref.taskId })
      else if (item.source.kind === 'interaction') await navigateContact({ kind: 'interaction', characterId: item.owner, interactionId: item.source.interactionId })
      else await navigateContact({ kind: 'task', characterId: item.owner, topicId: item.source.topicId })
    } catch (error) { setError(error instanceof Error ? error.message : '无法打开来源。') }
  }
  const pending = item.status === 'pending'
  const time = new Date(item.nextAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return <div className="reminder-actions reminder-followup" role="group" aria-label={`提醒操作：${item.label}`} data-reminder-id={item.id} data-reminder-revision={item.revision}>
    {showSource && <div className="reminder-followup-title">{item.label}</div>}
    <span className="reminder-followup-state" role="status">{pending ? `${item.read ? '已读' : '未读'} · 待处理` : item.status === 'processed' ? '已处理' : '已失效'}{!pending && item.reason ? ` · ${item.reason}` : ''}</span>
    {showSource && <button type="button" onClick={() => void navigate(true)}>查看原消息</button>}
    {pending && <>
      {!item.read && <button type="button" disabled={busy} onClick={() => void act('read')}>标记已读</button>}
      {item.acknowledgement === 'received' || item.acknowledgement === 'done'
        ? <button type="button" disabled={busy} onClick={() => void act('acknowledge')}>{item.acknowledgement === 'received' ? '知道了／已阅' : '已处理'}</button>
        : item.acknowledgement === 'task' ? <><button type="button" onClick={() => void navigate()}>查看任务</button><button type="button" disabled={busy} onClick={() => void act('complete')}>{item.source.kind === 'todo' && item.source.ref.checklistId ? '完成子项' : '完成任务'}</button></>
          : <button type="button" onClick={() => void navigate()}>去处理</button>}
      <div className="reminder-followup-schedule">
        <span>每 {item.intervalMinutes} 分钟提醒 · {item.postponed ? '已安排' : '下次'} {time}</span>
        <label><span className="sr-only">稍后提醒间隔</span><select aria-label="稍后提醒间隔" value={delay} disabled={busy} onChange={event => setDelay(Number(event.target.value))}>
          <option value={10}>10 分钟后</option><option value={30}>30 分钟后</option><option value={60}>1 小时后</option>
        </select></label>
        <button type="button" disabled={busy} onClick={() => void act('postpone', delay)}>{item.postponed ? '调整提醒' : '稍后提醒'}</button>
        {item.postponed && <button type="button" disabled={busy} onClick={() => void act('resume')}>恢复周期</button>}
        <details><summary>调整间隔</summary><div className="reminder-interval-editor">
          <label>每 <input aria-label="持续提醒间隔（分钟）" type="number" min={1} max={1440} step={1} value={interval} disabled={busy} onChange={event => setInterval(event.target.value)} /> 分钟</label>
          <button type="button" disabled={busy} onClick={() => void act('interval', Number(interval))}>应用</button>
        </div></details>
      </div>
    </>}
    {(error || item.error) && <span role="alert">{error || item.error}</span>}
  </div>
}
