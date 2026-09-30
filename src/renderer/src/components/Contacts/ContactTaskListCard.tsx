import { useEffect, useRef, useState } from 'react'
import type { ContactTaskItem } from './contactTaskPresentation'
import TaskIcon from '../Tasks/TaskIcon'

export default function ContactTaskListCard({ item, selected, disabled, onSelect, onDelete }: {
  item: ContactTaskItem; selected: boolean; disabled: boolean; onSelect: () => void; onDelete: () => void
}) {
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!menu) return
    const close = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setMenu(false); trigger.current?.focus() } }
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape)
    menuRef.current?.querySelector<HTMLButtonElement>('[data-task-delete]')?.focus()
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [menu])
  const stamp = (value?: number) => value ? <time dateTime={new Date(value).toISOString()}>{new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</time> : '未记录'
  return <div className="topic-list-item"><button type="button" className="topic-list-card" data-topic-id={item.id} data-assistant-task={item.scheduled ? item.id : undefined}
    aria-current={selected ? 'true' : undefined} disabled={disabled} onClick={onSelect}>
    <span className="topic-card-title">{item.title}</span>
    <span className="topic-badges">{item.focused && <span className="topic-badge topic-badge-focus">当前关注</span>}<span className={`topic-badge${item.running ? ' topic-badge-active' : ''}`}>{item.status}</span></span>
    <span className="topic-card-times"><span title="任务建立时间">开始 {stamp(item.createdAt)}</span><span>更新 {stamp(item.updatedAt)}</span></span>
  </button>
  {item.canDelete && <div className={`topic-card-menu${menu ? ' is-open' : ''}`} ref={menuRef}>
    <button ref={trigger} type="button" data-task-menu={item.id} aria-label={`「${item.title}」的操作`} aria-expanded={menu} disabled={disabled} onClick={() => setMenu(!menu)}><TaskIcon name="more" /></button>
    {menu && <div className="topic-card-menu-popover"><button type="button" data-task-delete onClick={() => { setMenu(false); onDelete() }}><TaskIcon name="trash" />删除任务</button></div>}
  </div>}
  </div>
}
