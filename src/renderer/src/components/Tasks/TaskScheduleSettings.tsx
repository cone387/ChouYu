import { useState } from 'react'
import { RECURRENCE_LABELS, type TaskRecurrence, type TaskRepeatRule } from '../../../../shared/tasks'
import { lunarDateAt, nextTaskOccurrence, repeatDescription, repeatRuleFor } from '../../../../shared/taskScheduling'
import type { TaskDraft } from './TaskEditorDialog'
import { draftDueAt, draftReminderTimes } from './taskDraftScheduling'

const units = { daily: '天', weekly: '周', monthly: '月', yearly: '年', lunarYearly: '农历年' }
const presets = [{ label: '截止时', offset: 0 }, { label: '提前 5 分钟', offset: 300000 }, { label: '提前 30 分钟', offset: 1800000 }, { label: '提前 1 小时', offset: 3600000 }, { label: '提前 1 天', offset: 86400000 }]
const localDate = (at: number) => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

function MonthDaysInput({ days, onChange }: { days: number[]; onChange(days: number[]): void }) {
  const [text, setText] = useState(days.join(','))
  return <label>每月日期<input aria-label="每月重复日期" placeholder="如 10,11；-1 表示月末" value={text} onChange={e => { setText(e.target.value); onChange(e.target.value.split(/[,，]/).map(Number)) }} /><small>可填多个日期；短月按月末执行，下月恢复原日期。</small></label>
}

export default function TaskScheduleSettings({ draft, busy, onChange }: { draft: TaskDraft; busy: boolean; onChange(draft: TaskDraft): void }) {
  const [customReminder, setCustomReminder] = useState('')
  const [reminderError, setReminderError] = useState('')
  const due = draftDueAt(draft)
  const reminders = draftReminderTimes(draft)
  const rule = draft.repeatRule ?? { frequency: 'daily', interval: 1, basis: 'scheduled' } as TaskRepeatRule
  const lunar = due !== null && Number.isFinite(due) && rule.frequency === 'lunarYearly' ? lunarDateAt(due) : { month: 1, day: 1 }
  const changeRule = (patch: Partial<TaskRepeatRule>) => onChange({ ...draft, recurrenceIndex: 1, recurrenceAnchorAt: due, repeatRule: { ...rule, ...patch } })
  const setReminders = (times: number[]) => {
    onChange({ ...draft, remind: 'none', reminderOffsets: due === null ? [] : times.map(at => due - at), reminderTimes: due === null ? times : [] })
    setReminderError('')
  }
  const addReminder = (at: number) => {
    if (!Number.isFinite(at)) { setReminderError('请选择提醒日期和时间。'); return }
    if (reminders.includes(at)) { setReminderError('这个提醒时间已添加。'); return }
    if (reminders.length >= 5) { setReminderError('最多设置 5 个提醒。'); return }
    setReminders([...reminders, at]); setCustomReminder('')
  }
  let preview = '', ruleError = ''
  if (draft.recurrence !== 'none' && due !== null) {
    try {
      preview = repeatDescription(draft.recurrence, draft.repeatRule)
      const next = nextTaskOccurrence(due, draft.recurrence, draft.repeatRule ?? null, due !== draft.originalDueAt ? due : draft.recurrenceAnchorAt ?? due, Date.now(), draft.recurrenceIndex ?? 1)
      preview += next === null ? ' · 无后续周期' : ` · 下次 ${new Date(next).toLocaleString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
    } catch (error) { ruleError = (error as Error).message }
  }
  return <fieldset className="tasks-schedule-settings" disabled={busy}>
    <legend className="sr-only">提醒与重复</legend>
    <div className="tasks-schedule-heading"><span>提醒 <small>{reminders.length}/5</small></span>{reminders.length > 0 && <button type="button" data-menu-keep-open onClick={() => setReminders([])}>不提醒</button>}</div>
    {reminders.length > 0 && <ul className="tasks-reminder-list">{reminders.map(at => <li key={at}><span>{new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span><button type="button" data-menu-keep-open aria-label={`移除提醒 ${new Date(at).toLocaleString('zh-CN')}`} onClick={() => setReminders(reminders.filter(t => t !== at))}>×</button></li>)}</ul>}
    <select aria-label="添加提醒" value="" disabled={due === null || reminders.length >= 5} onChange={e => { if (e.target.value !== '' && due !== null) addReminder(due - Number(e.target.value)) }}><option value="">添加相对截止时间的提醒</option>{presets.map(p => <option key={p.offset} value={p.offset} disabled={due !== null && reminders.includes(due - p.offset)}>{p.label}</option>)}</select>
    <div className="tasks-custom-reminder"><input type="datetime-local" aria-label="自定义提醒时间" value={customReminder} onChange={e => setCustomReminder(e.target.value)} /><button type="button" data-menu-keep-open disabled={!customReminder || reminders.length >= 5} onClick={() => addReminder(new Date(customReminder).getTime())}>添加</button></div>
    {reminderError && <p className="tasks-schedule-error" role="alert">{reminderError}</p>}
    <p className="tasks-schedule-hint">{due === null ? '也可单独设置提醒，无需截止日期。' : '修改截止时间时，提醒会同步平移。'}应用关闭或休眠时错过的提醒会在恢复后合并提示。</p>
    <label className="tasks-schedule-choice"><span>重复</span><select aria-label="任务重复规则" value={draft.recurrence} disabled={due === null} onChange={e => {
      const recurrence = e.target.value as TaskRecurrence
      onChange({ ...draft, recurrence, recurrenceIndex: 1, recurrenceAnchorAt: due, repeatRule: recurrence === 'custom' ? (draft.repeatRule ?? repeatRuleFor(draft.recurrence === 'none' ? 'daily' : draft.recurrence)) : null })
    }}>{Object.entries(RECURRENCE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
    {draft.recurrence === 'custom' && <div className="tasks-repeat-custom">
      <label className="tasks-schedule-choice"><span>计算方式</span><select aria-label="重复计算方式" value={rule.basis} disabled={rule.frequency === 'lunarYearly'} onChange={e => changeRule({ basis: e.target.value as TaskRepeatRule['basis'], weekdays: undefined, monthDays: undefined })}><option value="scheduled">按到期时间</option><option value="completed">按完成时间</option></select></label>
      <div className="tasks-repeat-interval"><span>每隔</span><input type="number" aria-label="重复间隔" min={1} max={365} value={rule.interval} onChange={e => changeRule({ interval: Number(e.target.value) })} /><select aria-label="重复频率" value={rule.frequency} onChange={e => changeRule({ frequency: e.target.value as TaskRepeatRule['frequency'], weekdays: undefined, monthDays: undefined, lunarMonth: undefined, lunarDay: undefined, ...(e.target.value === 'lunarYearly' ? { basis: 'scheduled' } : {}) })}>{Object.entries(units).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      {rule.frequency === 'weekly' && rule.basis === 'scheduled' && <div className="tasks-repeat-weekdays" role="group" aria-label="每周重复日期">{[1, 2, 3, 4, 5, 6, 0].map(day => {
        const days = rule.weekdays ?? [new Date(due!).getDay()]
        return <button type="button" data-menu-keep-open key={day} aria-label={`周${['日', '一', '二', '三', '四', '五', '六'][day]}`} aria-pressed={days.includes(day)} onClick={() => changeRule({ weekdays: days.includes(day) ? days.filter(d => d !== day) : [...days, day] })}>{['日', '一', '二', '三', '四', '五', '六'][day]}</button>
      })}</div>}
      {rule.frequency === 'monthly' && rule.basis === 'scheduled' && <MonthDaysInput days={rule.monthDays ?? [new Date(due!).getDate()]} onChange={monthDays => changeRule({ monthDays })} />}
      {rule.frequency === 'lunarYearly' && <div className="tasks-repeat-interval"><label>农历月<input type="number" aria-label="重复农历月" min={-12} max={12} value={rule.lunarMonth ?? lunar.month} onChange={e => changeRule({ lunarMonth: Number(e.target.value), lunarDay: rule.lunarDay ?? lunar.day })} /></label><label>农历日<input type="number" aria-label="重复农历日" min={1} max={30} value={rule.lunarDay ?? lunar.day} onChange={e => changeRule({ lunarMonth: rule.lunarMonth ?? lunar.month, lunarDay: Number(e.target.value) })} /></label><small>负数月份表示闰月</small></div>}
      <label className="tasks-schedule-choice"><span>结束重复</span><select aria-label="重复结束方式" value={rule.count !== undefined ? 'count' : rule.until !== undefined ? 'until' : 'never'} onChange={e => changeRule({ count: e.target.value === 'count' ? 10 : undefined, until: e.target.value === 'until' ? new Date(`${draft.dueDate}T23:59:59.999`).getTime() : undefined })}><option value="never">永不结束</option><option value="until">按日期</option><option value="count">按次数</option></select></label>
      {rule.until !== undefined && <input type="date" aria-label="重复结束日期" min={draft.dueDate} value={Number.isFinite(rule.until) ? localDate(rule.until) : ''} onChange={e => changeRule({ until: new Date(`${e.target.value}T23:59:59.999`).getTime() })} />}
      {rule.count !== undefined && <label>总次数（含当前次）<input type="number" aria-label="重复总次数" min={1} max={10000} value={rule.count} onChange={e => changeRule({ count: Number(e.target.value) })} /></label>}
      {rule.basis === 'completed' && <p className="tasks-schedule-hint">从实际完成时间起算；下次时间会随完成时间变化。</p>}
    </div>}
    {draft.recurrence !== 'none' && <p className="tasks-schedule-hint">完成当前任务后创建下一次并继承规则，保留完成记录。</p>}
    {(draft.recurrence === 'lunarYearly' || rule.frequency === 'lunarYearly' && draft.recurrence === 'custom') && <p className="tasks-schedule-hint">按所选日期对应的农历月日重复；无对应闰月时用普通月，小月三十按廿九执行。</p>}
    {preview && <p className="tasks-repeat-preview" aria-live="polite">{preview}</p>}
    {ruleError && <p className="tasks-schedule-error" role="alert">{ruleError}</p>}
  </fieldset>
}
