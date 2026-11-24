import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { ReminderAction, ReminderView } from '../../../../shared/reminder-followups'
import { navigateContact } from '../Contacts/contactNavigation'
import { openTaskWorkspace } from '../Tasks/taskNavigation'
import './NotificationCard.css'

type Panel = 'more' | 'delay' | 'settings'
export default function FollowupActions({ item, children, label = '通知提醒', active = true, onUpdated }: {
  item: ReminderView; children?: ReactNode; label?: string; active?: boolean; showSource?: boolean; onUpdated?: (item: ReminderView) => void
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [interval, setInterval] = useState(String(item.intervalMinutes))
  const [panel, setPanel] = useState<Panel | null>(null)
  const popup = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement | null>(null)
  const pendingAction = useRef(false), popupId = useId()
  const pending = item.status === 'pending'
  useEffect(() => { if (panel !== 'settings') setInterval(String(item.intervalMinutes)) }, [item.intervalMinutes, panel])
  const close = (focus = true) => { popup.current?.hidePopover?.(); setPanel(null); if (focus) trigger.current?.focus({ preventScroll: true }) }
  const open = (next: Panel, button: HTMLButtonElement) => { trigger.current = button; setPanel(panel === next ? null : next) }
  useEffect(() => { if (!active) close(false) }, [active])
  useEffect(() => { if (!pending && panel && panel !== 'more') close() }, [pending, panel])
  useLayoutEffect(() => {
    const element = popup.current
    if (!panel || !active || !element) return
    element.setAttribute('popover', 'manual')
    element.showPopover?.()
    const position = () => {
      const anchor = trigger.current?.getBoundingClientRect()
      if (!anchor) return
      const margin = 8, width = Math.min(panel === 'settings' ? 300 : 200, window.innerWidth - margin * 2)
      element.style.width = `${width}px`
      element.style.maxHeight = `${window.innerHeight - margin * 2}px`
      const height = element.getBoundingClientRect().height
      const top = anchor.bottom + height + margin <= window.innerHeight ? anchor.bottom + 5 : anchor.top - height - 5
      element.style.left = `${Math.max(margin, Math.min(anchor.right - width, window.innerWidth - width - margin))}px`
      element.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - height - margin))}px`
    }
    position()
    element.querySelector<HTMLElement>('input, button:not(:disabled)')?.focus({ preventScroll: true })
    const dismiss = (event: Event) => { if (!element.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(false) }
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopImmediatePropagation(); close()
    }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('focusin', dismiss, true)
    document.addEventListener('keydown', keyboard, true)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(position) : undefined
    observer?.observe(element)
    return () => {
      element.hidePopover?.(); observer?.disconnect()
      document.removeEventListener('pointerdown', dismiss, true); document.removeEventListener('focusin', dismiss, true); document.removeEventListener('keydown', keyboard, true)
      window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true)
    }
  }, [panel, active])
  const act = async (action: ReminderAction, minutes?: number) => {
    if (pendingAction.current) return
    pendingAction.current = true; setBusy(true); setError('')
    try { onUpdated?.(await window.electronAPI.reminders.act(item.id, item.revision, action, minutes)); close() }
    catch (error) { setError(error instanceof Error ? error.message : '提醒操作未保存，请重试。') }
    finally { pendingAction.current = false; setBusy(false) }
  }
  const navigate = async (original = false) => {
    setError('')
    try {
      if (original || item.source.kind === 'message') await navigateContact({ kind: 'message', sessionId: item.sessionId, messageId: item.messageId })
      else if (item.source.kind === 'todo') openTaskWorkspace({ taskId: item.source.ref.taskId })
      else if (item.source.kind === 'interaction') await navigateContact({ kind: 'interaction', characterId: item.owner, interactionId: item.source.interactionId })
      else await navigateContact({ kind: 'task', characterId: item.owner, topicId: item.source.topicId })
      close(false)
    } catch (error) { setError(error instanceof Error ? error.message : '无法打开来源。') }
  }
  const state = pending ? '待处理' : item.status === 'processed' ? '已处理' : '已失效'
  const time = new Date(item.nextAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return <section className="reminder-actions reminder-followup notification-card" aria-label={`提醒：${item.label}`} data-reminder-id={item.id} data-reminder-revision={item.revision}>
    <header className="notification-card-header">
      <span className="notification-card-kind"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5l-2 3Zm5 3h4" strokeLinecap="round" strokeLinejoin="round" /></svg>{item.source.kind === 'todo' ? '任务提醒' : label}</span>
      <span className={`notification-card-read${item.read ? '' : ' is-unread'}`}>{item.read ? '已读' : '未读'}</span>
      <button type="button" className="notification-card-more" aria-label="更多通知操作" aria-haspopup="dialog" aria-expanded={panel === 'more' || panel === 'settings'} aria-controls={panel ? popupId : undefined} onClick={event => open('more', event.currentTarget)}>⋯</button>
    </header>
    <div className="notification-card-content">{children ?? <h3 className="reminder-followup-title">{item.label}</h3>}</div>
    <span className="reminder-followup-state" role="status" aria-label={`${item.read ? '已读' : '未读'} · ${state}`}>
      {state}{!pending && item.reason ? ` · ${item.reason}` : ''}{pending && item.postponed ? ' · 已稍后提醒' : ''}
    </span>
    {pending && <footer className="notification-card-actions">
      {item.acknowledgement === 'received' || item.acknowledgement === 'done'
        ? <button type="button" className="notification-card-primary" disabled={busy} onClick={() => void act('acknowledge')}>{item.acknowledgement === 'received' ? '知道了' : '已处理'}</button>
        : item.acknowledgement === 'task' ? <button type="button" className="notification-card-primary" disabled={busy} onClick={() => void act('complete')}>{item.source.kind === 'todo' && item.source.ref.checklistId ? '完成子项' : '完成任务'}</button>
          : <button type="button" className="notification-card-primary" onClick={() => void navigate()}>去处理</button>}
      <button type="button" className="notification-card-delay" disabled={busy} aria-haspopup="dialog" aria-expanded={panel === 'delay'} aria-controls={panel ? popupId : undefined} onClick={event => open('delay', event.currentTarget)}>稍后提醒<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m2 4 4 4 4-4" /></svg></button>
    </footer>}
    {(error || item.error) && <span role="alert">{error || item.error}</span>}
    {panel && active && <div id={popupId} ref={popup} className="notification-card-popup" role="dialog" aria-label={panel === 'more' ? '通知操作' : panel === 'delay' ? '稍后提醒' : '提醒设置'} data-escape-overlay data-interactive data-interactive-bounds
      onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || (event.target as HTMLElement).tagName === 'INPUT') return
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
        if (!buttons.length) return
        event.preventDefault()
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus()
      }}>
      {panel === 'more' && <>
        {item.source.kind !== 'message' && <button type="button" onClick={() => void navigate()}>{item.source.kind === 'interaction' ? '查看事项' : '查看任务'}</button>}
        <button type="button" onClick={() => void navigate(true)}>查看原消息</button>
        {pending && <button type="button" onClick={() => setPanel('settings')}>提醒设置</button>}
        <button type="button" disabled={busy || item.read} onClick={() => void act('read')}>标记已读</button>
      </>}
      {panel === 'delay' && <>{[10, 30, 60].map(minutes => <button type="button" key={minutes} disabled={busy} onClick={() => void act('postpone', minutes)}>{minutes === 60 ? '1 小时后' : `${minutes} 分钟后`}</button>)}</>}
      {panel === 'settings' && <>
        <strong>提醒设置</strong>
        <p>每 {item.intervalMinutes} 分钟提醒<br />{item.postponed ? '已安排' : '下次'} {time}</p>
        <form onSubmit={event => { event.preventDefault(); void act('interval', Number(interval)) }}>
          <label className="reminder-interval-editor">每 <input aria-label="持续提醒间隔（分钟）" type="number" min={1} max={1440} step={1} required value={interval} disabled={busy} onChange={event => setInterval(event.target.value)} /> 分钟</label>
          <div className="notification-settings-actions"><button type="button" onClick={() => close()}>取消</button><button type="submit" disabled={busy}>保存</button></div>
        </form>
        {item.postponed && <button type="button" disabled={busy} onClick={() => void act('resume')}>恢复周期</button>}
      </>}
      {error && <span role="alert">{error}</span>}
    </div>}
  </section>
}
