import ContactPending from './ContactPending'
import ContactCurrentTask from './ContactCurrentTask'
import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { activatePanel } from '../../core/panel-layer'
import { CONTACT_TAB_GROUPS, ContactAgentPanel, type ContactAgentTab } from '../Contacts/ContactAgentPanel'
import TaskIcon, { type IconName } from '../Tasks/TaskIcon'
import './ContactWorkToolbar.css'
import type { AgentFocusRequest } from '../../../../shared/agents'
import type { AgentDiscussion } from '../Contacts/agentDiscussion'
import { ACTIVE_TASKS_HINT, summaryTokenHint, summaryTokens, useAgentSummary } from '../Contacts/useAgentSummary'
import { DEFAULT_CHARACTER_ID } from '../../../../shared/characters'
import type { DeliveryRef, TextAnchor } from '../../../../shared/contact-content'

const baseEntries: { id: ContactAgentTab; label: string; icon: IconName }[] = [
  { id: 'overview', label: '概览', icon: 'today' },
  { id: 'work', label: '任务', icon: 'task' },
  { id: 'portfolio', label: '成果', icon: 'archive' },
  { id: 'history', label: '工作记录', icon: 'clock' },
  { id: 'materials', label: '资料', icon: 'archive' },
  { id: 'memory', label: '记忆', icon: 'archive' },
  { id: 'skills', label: '技能', icon: 'archive' },
  { id: 'analytics', label: '消耗', icon: 'chart' }
]

/** Mount per conversation: drafts survive closing, never cross contact/session boundaries. */
export default function ContactWorkToolbar({ characterId, name, onClose, onChat, focusRequest, onDiscuss, initialTab = 'overview', standalone = false, profile, deliveryFocus, suspended = false, onReturn }: {
  suspended?: boolean; onReturn?: () => void
  deliveryFocus?: { ref: DeliveryRef; anchor?: TextAnchor }
  characterId: string; name: string; onClose: () => void; focusRequest?: AgentFocusRequest
  onDiscuss?: (reference: AgentDiscussion) => void
  initialTab?: ContactAgentTab; standalone?: boolean
  profile?: ReactNode
  onChat?: () => void
}) {
  const entries = profile ? [...baseEntries, { id: 'profile' as const, label: '人设', icon: 'edit' as const }] : baseEntries
  const [tab, setTab] = useState<ContactAgentTab>(initialTab)
  const [taskFocus, setTaskFocus] = useState<AgentFocusRequest>()
  const { data: summary, error: summaryError } = useAgentSummary(characterId, !suspended)
  const badge = (entry: ContactAgentTab) => entry === 'work' ? summary ? `共 ${summary.tasks} 项` : '—' : entry === 'memory' ? summary?.memories ?? '—' : undefined
  const hint = (entry: ContactAgentTab) => summaryError || (entry === 'overview' ? '查看今日趋势、24 小时工作记录与任务日志' : entry === 'work' ? `${ACTIVE_TASKS_HINT}${characterId === DEFAULT_CHARACTER_ID ? ' 同时包含已启用的日常陪伴、定时提醒和联系人总结；待设置时间不计入。' : ''}` : entry === 'analytics' ? summaryTokenHint(summary) : entry === 'memory' ? '当前保留的独立记忆条数' : '查看工作记录')
  const [analyticsReset, setAnalyticsReset] = useState(0)
  const [open, setOpen] = useState(standalone)
  const [visited, setVisited] = useState(standalone)
  const content = useRef<HTMLDivElement>(null)
  const toolbar = useRef<HTMLDivElement>(null)
  const sheet = useRef<HTMLDialogElement>(null)
  const id = useId()
  const gesture = useRef<{ kind: 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'; x: number; y: number; left: number; top: number; width: number; height: number } | null>(null)
  const positioned = useRef(false)
  const keepInView = () => {
    const dialog = sheet.current
    if (!dialog?.open || gesture.current) return
    if (!positioned.current) {
      const main = toolbar.current?.closest('.chat-panel')?.getBoundingClientRect()
      Object.assign(dialog.style, {
        left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
        width: `${Math.min(main?.width ?? 820, window.innerWidth - 16)}px`,
        height: `${Math.min(main?.height ?? 640, window.innerHeight - 16)}px`
      })
      dialog.dataset.resized = 'true'
      return
    }
    // Once moved by the user, keep that position even beyond viewport edges.
  }
  const beginGesture = (event: PointerEvent<HTMLElement>, kind: NonNullable<typeof gesture.current>['kind']) => {
    if (event.button !== 0 || (kind === 'move' && (event.target as HTMLElement).closest('button'))) return
    const dialog = sheet.current
    if (!dialog) return
    const rect = dialog.getBoundingClientRect()
    positioned.current = true
    gesture.current = { kind, x: event.screenX, y: event.screenY, left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    dialog.dataset.windowGesture = kind
    Object.assign(dialog.style, { left: `${rect.left}px`, top: `${rect.top}px`, transform: 'none' })
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  const moveGesture = (event: PointerEvent<HTMLElement>) => {
    const start = gesture.current, dialog = sheet.current
    if (!start || !dialog) return
    const dx = event.screenX - start.x, dy = event.screenY - start.y
    if (start.kind === 'move') {
      dialog.style.left = `${start.left + dx}px`
      dialog.style.top = `${start.top + dy}px`
    } else {
      const right = start.left + start.width, bottom = start.top + start.height
      const minWidth = Math.min(340, window.innerWidth - 16), minHeight = Math.min(240, window.innerHeight - 16)
      const left = start.kind.includes('w') ? Math.max(8, Math.min(start.left + dx, right - minWidth)) : start.left
      const top = start.kind.includes('n') ? Math.max(8, Math.min(start.top + dy, bottom - minHeight)) : start.top
      const width = start.kind.includes('w') ? right - left : start.kind.includes('e') ? Math.max(minWidth, Math.min(start.width + dx, window.innerWidth - left - 8)) : start.width
      const height = start.kind.includes('n') ? bottom - top : start.kind.includes('s') ? Math.max(minHeight, Math.min(start.height + dy, window.innerHeight - top - 8)) : start.height
      Object.assign(dialog.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` })
      dialog.dataset.resized = 'true'
    }
  }
  const endGesture = (event: PointerEvent<HTMLElement>) => {
    gesture.current = null
    if (sheet.current) delete sheet.current.dataset.windowGesture
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    keepInView()
  }
  const close = () => { window.dispatchEvent(new Event('chouyu:contact-reader-flush')); sheet.current?.close(); setOpen(false); onClose() }
  useEffect(() => {
    const hide = () => { window.dispatchEvent(new Event('chouyu:contact-reader-flush')); sheet.current?.close(); setOpen(false) }
    const restore = (event: Event) => { const location = (event as CustomEvent<import('../Contacts/contactReturnLocation').ContactReturnLocation>).detail; if (location.surfaceId === id) { setTab(location.tab); setOpen(true) } }
    window.addEventListener('chouyu:contact-navigation-opened', hide)
    window.addEventListener('chouyu:contact-return', restore)
    return () => { window.removeEventListener('chouyu:contact-navigation-opened', hide); window.removeEventListener('chouyu:contact-return', restore) }
  }, [id])
  useEffect(() => {
    if (focusRequest) { setTaskFocus(focusRequest); setTab(focusRequest.tab); setVisited(true); setOpen(true) }
  }, [focusRequest])
  useEffect(() => {
    const dialog = sheet.current
    if (open && !suspended && dialog && !dialog.open) { positioned.current = false; dialog.show(); keepInView(); activatePanel(dialog) }
    return () => { if (dialog?.open) dialog.close() }
  }, [open, suspended])
  useEffect(() => {
    window.addEventListener('resize', keepInView)
    return () => window.removeEventListener('resize', keepInView)
  }, [])
  useEffect(() => {
    if (!sheet.current) return
    const observer = new ResizeObserver(keepInView)
    observer.observe(sheet.current)
    return () => observer.disconnect()
  }, [visited])
  const select = (next: ContactAgentTab) => {
    setTab(next)
    if (next !== tab && content.current) content.current.scrollTop = 0
  }
  const selectFromHeader = (next: ContactAgentTab) => window.dispatchEvent(new CustomEvent('chouyu:contact-select-tab', { detail: { surface: id, tab: next } }))

  return <div ref={toolbar} className="contact-work-tools" data-contact-work-tools={characterId} style={standalone ? { display: 'none' } : undefined}>
    {visited && createPortal(<dialog className="contact-work-sheet" id={id} ref={sheet} data-contact-work-surface={id} data-view={tab} data-interactive aria-modal="false" data-panel-window="contact" onPointerDownCapture={event => activatePanel(event.target)}
      aria-label={`${name} · ${tab === 'settings' ? '工作设置' : entries.find(entry => entry.id === tab)!.label}`}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}
      onCancel={event => { event.preventDefault(); close() }}>
      <header className="contact-work-sheet-heading" onPointerDown={event => beginGesture(event, 'move')} onPointerMove={moveGesture} onPointerUp={endGesture} onPointerCancel={endGesture} onLostPointerCapture={endGesture}>
        <strong>{name}的{tab === 'overview' ? '今日概览' : tab === 'work' ? '任务' : tab === 'portfolio' ? '成果' : tab === 'history' ? '工作记录' : tab === 'settings' ? '工作设置' : tab === 'analytics' ? '活动与消耗' : tab === 'materials' ? '资料' : tab === 'skills' ? '技能' : '记忆'}</strong>
      <div className="contact-work-buttons contact-work-dialog-tabs" role="group" aria-label="联系人工作内容">
        {CONTACT_TAB_GROUPS.map(group => <div key={group.label} className="contact-work-tab-group" role="group" aria-label={group.label}><small>{group.label}</small>{group.tabs.filter(([entry]) => entry !== 'profile' || profile).map(([entry, label]) => <button key={entry} type="button" data-contact-dialog-tab={entry}
          aria-label={`${name}的${label}`} title={hint(entry)} aria-pressed={tab === entry} onClick={() => { if (entry === 'analytics') setAnalyticsReset(n => n + 1); selectFromHeader(entry) }}>
          <span>{label}</span>{badge(entry) !== undefined && <small className="contact-work-count">{badge(entry)}</small>}
        </button>)}</div>)}
      </div>
        {onChat && <button type="button" data-agent-chat aria-label={`与${name}聊天`} onClick={() => { close(); onChat() }}>聊天</button>}
        {onReturn && <button type="button" data-contact-return aria-label={`从${name}的设置返回原事项`} onClick={onReturn}>返回原事项</button>}
        <button type="button" aria-label="关闭联系人工作弹窗" onClick={close}>关闭</button>
      </header>
      <div className="contact-work-sheet-content" ref={content}>
        <ContactAgentPanel visible={open && !suspended} characterId={characterId} name={name} profile={profile} deliveryFocus={deliveryFocus} analyticsReset={analyticsReset} compact selectedTab={tab} onTabChange={select} focusRequest={taskFocus ?? focusRequest} onDiscuss={onDiscuss ? reference => { onDiscuss(reference); close() } : undefined} onChat={() => { close(); onChat?.() }} />
      </div>
      {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const).map(edge => <div key={edge} className={`contact-work-resize contact-work-resize-${edge}`} data-resize-edge={edge} aria-label={`调整窗口大小 ${edge}`} role="separator" tabIndex={0}
        onPointerDown={event => beginGesture(event, edge)} onPointerMove={moveGesture} onPointerUp={endGesture} onPointerCancel={endGesture} onLostPointerCapture={endGesture}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || !sheet.current) return
          event.preventDefault()
          const dialog = sheet.current, rect = dialog.getBoundingClientRect()
          dialog.style.width = `${Math.max(Math.min(340, window.innerWidth - rect.left - 8), Math.min(rect.width + (event.key === 'ArrowRight' ? 20 : event.key === 'ArrowLeft' ? -20 : 0), window.innerWidth - rect.left - 8))}px`
          dialog.style.height = `${Math.max(Math.min(240, window.innerHeight - rect.top - 8), Math.min(rect.height + (event.key === 'ArrowDown' ? 20 : event.key === 'ArrowUp' ? -20 : 0), window.innerHeight - rect.top - 8))}px`
          dialog.dataset.resized = 'true'
        }} />)}
    </dialog>, document.body)}
    <div className="contact-work-buttons" role="group" aria-label="联系人快捷工具" hidden={standalone}>
      {!standalone && <ContactPending characterId={characterId} />}
      {!standalone && <ContactCurrentTask key={characterId} characterId={characterId} onOpen={focus => { setTaskFocus(focus); setTab(focus.tab); setVisited(true); setOpen(true); if (open) activatePanel(sheet.current) }} />}
      {entries.map(entry => <button key={entry.id} type="button" data-contact-work-tab={entry.id}
        aria-haspopup="dialog" aria-expanded={open && tab === entry.id} aria-controls={visited ? id : undefined}
        title={`查看${name}的${entry.label}。${hint(entry.id)}`} onClick={() => {
          if (entry.id === 'analytics') setAnalyticsReset(n => n + 1)
          if (open && tab === entry.id && sheet.current?.dataset.panelActive === 'true') close()
          else { select(entry.id); setVisited(true); setOpen(true); if (open) activatePanel(sheet.current) }
        }}>
        <TaskIcon name={entry.icon} /><span>{entry.label}</span>{badge(entry.id) !== undefined && <small className="contact-work-count">{badge(entry.id)}</small>}{entry.id === 'analytics' && <small className="contact-work-usage">{summaryTokens(summary)} Token</small>}
      </button>)}
    </div>
  </div>
}
