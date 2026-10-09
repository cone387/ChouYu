import { useEffect, useId, useRef, useState } from 'react'
import './WorkTimePicker.css'

export default function WorkTimePicker({ label, value, disabled, onChange }: {
  label: string; value: string; disabled: boolean; onChange: (value: string) => void
}) {
  const id = useId(), anchor = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
  const [hour, minute] = (valid ? value : '00:00').split(':')
  const close = () => { panel.current?.hidePopover(); setOpen(false) }
  const show = (focus = false) => {
    if (disabled || !panel.current || !anchor.current) return
    const rect = anchor.current.getBoundingClientRect(), width = Math.min(224, window.innerWidth - 16), height = 274
    Object.assign(panel.current.style, { left: `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`,
      top: `${rect.bottom + height + 6 < window.innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - height - 6)}px`, width: `${width}px` })
    panel.current.showPopover(); setOpen(true)
    for (const column of panel.current.querySelectorAll('.work-time-column')) {
      const selected = column.querySelector<HTMLElement>('[aria-pressed=true]')
      if (selected) column.scrollTop = selected.offsetTop - column.clientHeight / 2 + selected.offsetHeight / 2
    }
    if (focus) panel.current.querySelector<HTMLElement>('[aria-pressed=true]')?.focus({ preventScroll: true })
  }
  useEffect(() => { if (disabled) { panel.current?.hidePopover(); setOpen(false) } }, [disabled])
  useEffect(() => {
    const el = panel.current
    const sync = () => setOpen(Boolean(el?.matches(':popover-open')))
    const hide = (event: Event) => { if (!(event.target instanceof Node) || !el?.contains(event.target)) { el?.hidePopover(); setOpen(false) } }
    el?.addEventListener('toggle', sync)
    window.addEventListener('resize', hide); window.addEventListener('scroll', hide, true)
    return () => { el?.removeEventListener('toggle', sync); window.removeEventListener('resize', hide); window.removeEventListener('scroll', hide, true) }
  }, [])
  return <div className="work-time-picker" ref={anchor} onKeyDown={event => { if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); input.current?.focus() } }}>
    <input ref={input} aria-label={label} aria-controls={id} aria-expanded={open} aria-haspopup="dialog" type="text" inputMode="numeric" required
      pattern="([01][0-9]|2[0-3]):[0-5][0-9]" maxLength={5} placeholder="HH:mm" title="24 小时制，例如 09:30" disabled={disabled} value={value}
      onChange={event => onChange(event.target.value)} onClick={() => show()} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); show(true) } }} />
    <button type="button" className="work-time-trigger" aria-label={`选择${label}`} aria-expanded={open} aria-controls={id} disabled={disabled} onClick={() => open ? close() : show(true)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
    </button>
    <div id={id} ref={panel} {...{ popover: 'auto' }} role="dialog" aria-label={`选择${label}`} className="work-time-popover" data-interactive
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); input.current?.focus() } }}>
      <header>{label}<span>24 小时制</span></header>
      <div className="work-time-column-head"><span>时</span><span>分</span></div>
      <div className="work-time-columns">
        {[24, 60].map((count, index) => <div key={count} className="work-time-column" role="group" aria-label={index ? '分钟' : '小时'}>
          {Array.from({ length: count }, (_, n) => String(n).padStart(2, '0')).map(part => <button key={part} type="button" aria-pressed={part === (index ? minute : hour)}
            onKeyDown={event => { if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const buttons = Array.from(event.currentTarget.parentElement!.querySelectorAll('button')); const target = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : (Number(part) + (event.key === 'ArrowDown' ? 1 : count - 1)) % count; buttons[target].focus() } }}
            onClick={() => { onChange(index ? `${hour}:${part}` : `${part}:${minute}`); if (index) { close(); input.current?.focus() } }}>{part}</button>)}
        </div>)}
      </div>
    </div>
  </div>
}
