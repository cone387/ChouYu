import { useState } from 'react'
import type { TaskInputField } from '../../../../shared/agent-delivery'

export default function ContactTaskInputForm({ fields, busy, onSubmit, label = '补充并继续' }: {
  fields: TaskInputField[]; busy: boolean; onSubmit: (answer: string, values: Record<string, string>) => Promise<void>; label?: string
}) {
  const [values, setValues] = useState(() => Object.fromEntries(fields.map(field => [field.id, field.value])))
  const [note, setNote] = useState(''), [error, setError] = useState(''), [pending, setPending] = useState(false)
  return <form className="contact-input-form" onSubmit={event => {
    event.preventDefault()
    const answer = fields.map(field => `${field.label}：${values[field.id]?.trim() || '未指定，由联系人判断'}`).join('\n') + (note.trim() ? `\n补充说明：${note.trim()}` : '')
    if (answer.length > 2000) { setError('补充内容合计需在 2000 字以内，请精简后提交。'); return }
    setError(''); setPending(true)
    void onSubmit(answer, values).catch(e => setError(e instanceof Error ? e.message : '提交失败，请重试。')).finally(() => setPending(false))
  }}>
    <p className="agent-caption">联系人为这项任务整理的需求，已知内容已填入。你可以直接修改。</p>
    {fields.map(field => <label key={field.id}>{field.label}{field.required && !field.value ? '（待补充）' : ''}
      <textarea rows={2} maxLength={1000} required={field.required} disabled={busy || pending} value={values[field.id] ?? ''} onChange={e => setValues({ ...values, [field.id]: e.target.value })} />
      {field.hint && <span className="agent-caption">{field.hint}</span>}
      {field.options && <span className="agent-actions">{field.options.map(option => <button type="button" key={option} disabled={busy || pending} aria-pressed={values[field.id] === option} onClick={() => setValues({ ...values, [field.id]: option })}>{option}</button>)}</span>}
    </label>)}
    <label>补充说明<textarea rows={2} maxLength={1000} disabled={busy || pending} value={note} onChange={e => setNote(e.target.value)} /></label>
    {error && <p role="alert">{error}</p>}
    <button type="submit" disabled={busy || pending}>{pending ? '正在提交…' : label}</button>
  </form>
}
