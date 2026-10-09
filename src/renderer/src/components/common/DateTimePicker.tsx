import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DayPicker } from 'react-day-picker'
import { zhCN } from 'react-day-picker/locale'
import 'react-day-picker/style.css'
import './DateTimePicker.css'

export const localDateValue = (day: Date) => `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
export function parseLocalDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const date = new Date(`${value}T12:00:00`)
  return Number.isFinite(date.getTime()) && localDateValue(date) === value ? date : undefined
}

export interface DateTimePickerProps {
  label: string
  value: string
  onChange(value: string): void
  placeholder?: string
  triggerLabel?: string
  disabled?: boolean
  mode?: 'date' | 'datetime'
  min?: string
  max?: string
  allowClear?: boolean
}

export default function DateTimePicker({ label, value, onChange, placeholder = '选择日期时间', triggerLabel, disabled = false, mode = 'datetime', min, max, allowClear = true }: DateTimePickerProps) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return <>
    <button ref={trigger} type="button" className="app-datetime-trigger" data-interactive aria-label={label} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} data-value={value} onClick={() => setOpen(true)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M5 4h14v16H5zM8 2v4M16 2v4M5 9h14" /></svg>{triggerLabel && <span className="app-datetime-trigger-label">{triggerLabel}</span>}<span>{value ? value.replace('T', ' ') : placeholder}</span>
    </button>
    {open && createPortal(<DateTimeDialog label={label} value={value} mode={mode} min={min} max={max} allowClear={allowClear} onChange={onChange} onClose={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }) }} />, document.body)}
  </>
}

function DateTimeDialog({ label, value, mode, min, max, allowClear, onChange, onClose }: Required<Pick<DateTimePickerProps, 'label' | 'value' | 'mode' | 'allowClear' | 'onChange'>> & Pick<DateTimePickerProps, 'min' | 'max'> & { onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const [date, setDate] = useState(value.slice(0, 10))
  const [time, setTime] = useState(value.slice(11, 16) || '09:00')
  const [month, setMonth] = useState(parseLocalDate(date) ?? new Date())
  const [error, setError] = useState('')
  const [timeOpen, setTimeOpen] = useState(false)
  const timeColumns = useRef<(HTMLDivElement | null)[]>([])
  const parts = time.split(':')
  const selectTime = (index: number, part: string) => {
    setTime(index === 0 ? `${part}:${parts[1]}` : `${parts[0]}:${part}`)
    setError('')
  }
  const selected = parseLocalDate(date)
  const earliest = min ? parseLocalDate(min.slice(0, 10)) : undefined
  const latest = max ? parseLocalDate(max.slice(0, 10)) : undefined
  useEffect(() => { dialog.current?.showModal() }, [])
  useEffect(() => {
    for (const column of timeColumns.current) {
      const selectedOption = column?.querySelector<HTMLElement>('[aria-selected=true]')
      if (column && selectedOption) column.scrollTop = selectedOption.offsetTop - column.clientHeight / 2 + selectedOption.offsetHeight / 2
    }
  }, [time, timeOpen])
  const save = () => {
    if (!selected) { setError('请选择有效日期。'); return }
    if (mode === 'datetime' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) { setError('请选择有效时间。'); return }
    const next = mode === 'date' ? date : `${date}T${time}`
    if (min && next < min || max && next > max) { setError('所选时间超出允许范围。'); return }
    onChange(next); onClose()
  }
  return <dialog ref={dialog} className="app-datetime-dialog" data-interactive aria-labelledby={heading} onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose() }} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); onClose() } }} onClick={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}>
    <form onSubmit={event => { event.preventDefault(); event.stopPropagation(); save() }} noValidate>
      <header><h2 id={heading}>{label}</h2><button type="button" aria-label="关闭日期时间选择" onClick={onClose}>×</button></header>
      <div className="app-datetime-body">
        <div className="app-datetime-stage">
        {!timeOpen && <DayPicker mode="single" locale={zhCN} weekStartsOn={1} fixedWeeks showOutsideDays month={month} onMonthChange={setMonth} selected={selected} onSelect={day => { if (day) { setDate(localDateValue(day)); setMonth(day); setError('') } }} disabled={[...(earliest ? [{ before: earliest }] : []), ...(latest ? [{ after: latest }] : [])]} labels={{ labelDayButton: day => localDateValue(day), labelPrevious: () => '上个月', labelNext: () => '下个月' }} />}
        {timeOpen && mode === 'datetime' && <div className="app-time-picker" role="group" aria-label={`${label}时间`}>
          <div className="app-time-heading"><span>选择时间</span><button type="button" onClick={() => { setTimeOpen(false); dialog.current?.querySelector<HTMLButtonElement>('.app-time-toggle')?.focus() }}>返回日历</button></div>
          <div className="app-time-columns">{[24, 60].map((count, index) => <div key={count}>
            <div className="app-time-column-label">{index === 0 ? '时' : '分'}</div>
            <div ref={element => { timeColumns.current[index] = element }} className="app-time-column" role="listbox" aria-label={index === 0 ? '小时' : '分钟'}>
              {Array.from({ length: count }, (_, number) => String(number).padStart(2, '0')).map(part => <button key={part} type="button" role="option" data-value={part} aria-selected={parts[index] === part} tabIndex={parts[index] === part ? 0 : -1}
                onClick={() => selectTime(index, part)} onKeyDown={event => {
                  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
                  event.preventDefault()
                  const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : (Number(part) + (event.key === 'ArrowDown' ? 1 : count - 1)) % count
                  selectTime(index, String(next).padStart(2, '0'))
                  timeColumns.current[index]?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus({ preventScroll: true })
                }}>{part}</button>)}
            </div>
          </div>)}</div>
          <div className="app-time-presets" role="group" aria-label="常用分钟"><span>分钟</span>{['00', '15', '30', '45'].map(minute => <button key={minute} type="button" aria-label={`${minute}分`} aria-pressed={parts[1] === minute} onClick={() => selectTime(1, minute)}>{minute}</button>)}</div>
        </div>}
        </div>
        <div className="app-datetime-inputs">
          <label><span>日期</span><input autoFocus aria-label={`${label}日期`} placeholder="YYYY-MM-DD" value={date} inputMode="numeric" maxLength={10} onChange={event => { setDate(event.target.value); setError(''); const next = parseLocalDate(event.target.value); if (next) setMonth(next) }} /></label>
          {mode === 'datetime' && <button type="button" className="app-time-toggle" aria-label="选择时分" aria-expanded={timeOpen} onClick={() => setTimeOpen(!timeOpen)}><span>时间</span><strong>{time}</strong><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={timeOpen ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} /></svg></button>}
        </div>
        {error && <p role="alert" className="app-datetime-error">{error}</p>}
      </div>
      <footer>{allowClear && <button type="button" className="app-datetime-clear" onClick={() => { onChange(''); onClose() }}>清除</button>}<button type="button" onClick={onClose}>取消</button><button type="submit" className="app-datetime-confirm">确定</button></footer>
    </form>
  </dialog>
}
