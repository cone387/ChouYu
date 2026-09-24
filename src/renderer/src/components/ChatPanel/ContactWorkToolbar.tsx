import { useEffect, useId, useRef, useState } from 'react'
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
  const sheet = useRef<HTMLDialogElement>(null)
  const id = useId()
  const close = () => { sheet.current?.close(); setOpen(false); onClose() }
  useEffect(() => {
    if (focusRequest) { setTab(focusRequest.tab); setVisited(true); setOpen(true) }
  }, [focusRequest])
  useEffect(() => {
    const dialog = sheet.current
    if (open && dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [open])
  const select = (next: ContactAgentTab) => {
    setTab(next)
    if (next !== tab && content.current) content.current.scrollTop = 0
  }

  return <div className="contact-work-tools" data-contact-work-tools={characterId}>
    {visited && <dialog className="contact-work-sheet" id={id} ref={sheet}
      aria-label={`${name} · ${entries.find(entry => entry.id === tab)!.label}`}
      onCancel={event => { event.preventDefault(); close() }}>
      <header className="contact-work-sheet-heading">
        <strong>{name}的{tab === 'work' ? '任务' : tab === 'history' ? '工作记录' : '记忆'}</strong>
        <button type="button" aria-label="关闭联系人工作弹窗" onClick={close}>关闭</button>
      </header>
      <div className="contact-work-buttons contact-work-dialog-tabs" role="group" aria-label="联系人工作内容">
        {entries.map(entry => <button key={entry.id} type="button" data-contact-dialog-tab={entry.id}
          aria-pressed={tab === entry.id} onClick={() => select(entry.id)}>
          <TaskIcon name={entry.icon} /><span>{entry.label}</span>
        </button>)}
      </div>
      <div className="contact-work-sheet-content" ref={content}>
        <ContactAgentPanel characterId={characterId} name={name} compact selectedTab={tab} onTabChange={select} focusRequest={focusRequest} onDiscuss={reference => { onDiscuss(reference); close() }} />
      </div>
    </dialog>}
    <div className="contact-work-buttons" role="group" aria-label="联系人快捷工具">
      {entries.map(entry => <button key={entry.id} type="button" data-contact-work-tab={entry.id}
        aria-haspopup="dialog" aria-expanded={open && tab === entry.id} aria-controls={visited ? id : undefined}
        title={`查看${name}的${entry.label}`} onClick={() => {
          if (open && tab === entry.id) close()
          else { select(entry.id); setVisited(true); setOpen(true) }
        }}>
        <TaskIcon name={entry.icon} /><span>{entry.label}</span>
      </button>)}
    </div>
  </div>
}
