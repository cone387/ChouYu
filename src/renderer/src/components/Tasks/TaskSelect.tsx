import { useId, useRef, useState } from 'react'
import TaskIcon from './TaskIcon'

export default function TaskSelect({ label, value, options, disabled = false, onChange }: {
  label: string
  value: string
  options: { value: string; label: string }[]
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const id = useId()
  const ref = useRef<HTMLDetailsElement>(null)
  const [open, setOpen] = useState(false)
  const focusOption = (last = false) => requestAnimationFrame(() => {
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])
    const index = options.findIndex(option => option.value === value)
    buttons[last ? buttons.length - 1 : Math.max(0, index)]?.focus()
  })
  return <details ref={ref} className="tasks-tool-menu tasks-select" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary role="combobox" aria-label={label} aria-controls={id} aria-haspopup="listbox" aria-expanded={open} aria-disabled={disabled} data-value={value}
      tabIndex={disabled ? -1 : 0}
      onClick={event => { if (disabled) event.preventDefault() }}
      onKeyDown={event => {
        if (disabled) { event.preventDefault(); return }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          if (ref.current) ref.current.open = true
          focusOption(event.key === 'ArrowUp')
        }
      }}><span>{options.find(option => option.value === value)?.label ?? '请选择'}</span><TaskIcon name="chevron" /></summary>
    <div id={id} className="tasks-item-menu-popover tasks-select-options" role="listbox" aria-label={label}
      onKeyDown={event => {
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'))
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
          buttons[next]?.focus()
        }
      }}>
      {options.map(option => <button type="button" role="option" aria-selected={option.value === value} data-value={option.value} key={option.value} onClick={() => { onChange(option.value); ref.current?.querySelector<HTMLElement>('summary')?.focus() }}><span>{option.label}</span>{option.value === value && <span aria-hidden="true">✓</span>}</button>)}
    </div>
  </details>
}
