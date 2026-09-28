import { useEffect, useId, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { activatePanel } from '../../core/panel-layer'
import { ContactAgentPanel, type ContactAgentTab } from '../Contacts/ContactAgentPanel'
import TaskIcon, { type IconName } from '../Tasks/TaskIcon'
import './ContactWorkToolbar.css'
import type { AgentFocusRequest } from '../../../../shared/agents'
import type { AgentDiscussion } from '../Contacts/agentDiscussion'

const entries: { id: ContactAgentTab; label: string; icon: IconName }[] = [
  { id: 'work', label: '任务', icon: 'task' },
  { id: 'history', label: '工作记录', icon: 'clock' },
  { id: 'memory', label: '记忆', icon: 'archive' }
]

/** Mount per conversation: drafts survive closing, never cross contact/session boundaries. */
export default function ContactWorkToolbar({ characterId, name, onClose, focusRequest, onDiscuss }: {
  characterId: string; name: string; onClose: () => void; focusRequest?: AgentFocusRequest
  onDiscuss: (reference: AgentDiscussion) => void
}) {
  const [tab, setTab] = useState<ContactAgentTab>('work')
  const [open, setOpen] = useState(false)
  const [visited, setVisited] = useState(false)
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
    const rect = dialog.getBoundingClientRect()
    const width = Math.min(rect.width, window.innerWidth - 16)
    const height = Math.min(rect.height, window.innerHeight - 16)
    Object.assign(dialog.style, { left: `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`, top: `${Math.max(8, Math.min(rect.top, window.innerHeight - height - 8))}px`, transform: 'none' })
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
      dialog.style.left = `${Math.max(8, Math.min(start.left + dx, window.innerWidth - start.width - 8))}px`
      dialog.style.top = `${Math.max(8, Math.min(start.top + dy, window.innerHeight - start.height - 8))}px`
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
  const close = () => { sheet.current?.close(); setOpen(false); onClose() }
  useEffect(() => {
    if (focusRequest) { setTab(focusRequest.tab); setVisited(true); setOpen(true) }
  }, [focusRequest])
  useEffect(() => {
    const dialog = sheet.current
    if (open && dialog && !dialog.open) { positioned.current = false; dialog.show(); keepInView(); activatePanel(dialog) }
    return () => { if (dialog?.open) dialog.close() }
  }, [open])
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

  return <div ref={toolbar} className="contact-work-tools" data-contact-work-tools={characterId}>
    {visited && createPortal(<dialog className="contact-work-sheet" id={id} ref={sheet} data-view={tab} data-interactive aria-modal="false" data-panel-window="contact" onPointerDownCapture={event => activatePanel(event.target)}
      aria-label={`${name} · ${tab === 'settings' ? '工作设置' : entries.find(entry => entry.id === tab)!.label}`}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}
      onCancel={event => { event.preventDefault(); close() }}>
      <header className="contact-work-sheet-heading" onPointerDown={event => beginGesture(event, 'move')} onPointerMove={moveGesture} onPointerUp={endGesture} onPointerCancel={endGesture} onLostPointerCapture={endGesture}>
        <strong>{name}的{tab === 'work' ? '任务' : tab === 'history' ? '工作记录' : tab === 'settings' ? '工作设置' : '记忆'}</strong>
        <button type="button" aria-label="关闭联系人工作弹窗" onClick={close}>关闭</button>
      </header>
      <div className="contact-work-buttons contact-work-dialog-tabs" role="group" aria-label="联系人工作内容">
        {entries.map(entry => <button key={entry.id} type="button" data-contact-dialog-tab={entry.id}
          aria-pressed={tab === entry.id} onClick={() => select(entry.id)}>
          <TaskIcon name={entry.icon} /><span>{entry.label}</span>
        </button>)}
        <button type="button" className="contact-work-settings-link" data-contact-dialog-tab="settings" aria-pressed={tab === 'settings'} onClick={() => select('settings')}>工作设置</button>
      </div>
      <div className="contact-work-sheet-content" ref={content}>
        <ContactAgentPanel characterId={characterId} name={name} compact selectedTab={tab} onTabChange={select} focusRequest={focusRequest} onDiscuss={reference => { onDiscuss(reference); close() }} onChat={close} />
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
    <div className="contact-work-buttons" role="group" aria-label="联系人快捷工具">
      {entries.map(entry => <button key={entry.id} type="button" data-contact-work-tab={entry.id}
        aria-haspopup="dialog" aria-expanded={open && tab === entry.id} aria-controls={visited ? id : undefined}
        title={`查看${name}的${entry.label}`} onClick={() => {
          if (open && tab === entry.id && sheet.current?.dataset.panelActive === 'true') close()
          else { select(entry.id); setVisited(true); setOpen(true); if (open) activatePanel(sheet.current) }
        }}>
        <TaskIcon name={entry.icon} /><span>{entry.label}</span>
      </button>)}
    </div>
  </div>
}
